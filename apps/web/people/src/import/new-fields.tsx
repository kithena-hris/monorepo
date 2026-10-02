import {
  AccessStrip,
  Badge,
  Button,
  Card,
  ChipGroup,
  ChipGroupItem,
  Field,
  FieldControl,
  FieldDescription,
  FieldLabel,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  TagsInput,
  icons,
} from '@reach/ui';
import { useId, useState, type JSX } from 'react';

import { AUDIENCES, TypeIcon, accessOf } from '../settings/access';
import type { Classification, DataType, PiiKind, ViewerScope, WriterRole } from '../settings/model';
import { DATA_TYPE_LABEL, SCOPE_LABEL, WRITER_LABEL } from '../settings/words';

/**
 * The import review's new fields (design AI9, AI10): the columns that match
 * no field, proposed as fields, each a card, and under each what happens for
 * the people who will have no value.
 *
 * Nothing here decides. People proposes (with the assistant, from the
 * columns' headers and the shape of their values, never a value), HR switches
 * each on or off and edits it, and the plan above them says what importing
 * will do. A column that can reveal health or religion is held back and
 * explained; HR may still import it. HR without administrator rights sees the
 * whole proposal and is told an administrator adds fields.
 */

export type ForExisting =
  | { readonly kind: 'ask' }
  | { readonly kind: 'hr' }
  | { readonly kind: 'new' }
  | { readonly kind: 'leave' }
  | { readonly kind: 'default'; readonly value: string };

export interface NewField {
  readonly label: string;
  readonly dataType: DataType;
  readonly options?: readonly string[];
  readonly country?: string | null;
  readonly description?: string | null;
  readonly required: boolean;
  readonly ownership: readonly WriterRole[];
  readonly visibility: readonly ViewerScope[];
  readonly classification: Classification;
  readonly piiKind: PiiKind;
  readonly encrypted: boolean;
  readonly aiEligible: boolean;
}

export interface ColumnProposal {
  readonly column: number;
  readonly header: string;
  /** What the values look like, in words: "dates, dd/mm/yyyy". */
  readonly shape: string;
  readonly include: boolean;
  readonly key: string;
  readonly field: NewField;
  readonly placement: { readonly sectionKey: string } | { readonly newSection: string };
  readonly why: string;
  readonly forExisting: ForExisting;
  readonly forExistingWhy: string;
  /** How sure People's rules are of the type. */
  readonly confidence: 'high' | 'medium';
}

export interface ColumnCounts {
  /** People who will have a value once the file is in. */
  readonly have: number;
  /** Everybody else, after the import. */
  readonly missing: number;
  readonly existingWithout: number;
}

export interface NewFieldsView {
  readonly canCreate: boolean;
  readonly blocked: string | null;
  readonly proposals: readonly (ColumnProposal & {
    readonly counts: ColumnCounts;
    readonly sensitive: string | null;
  })[];
  readonly sections: readonly { readonly key: string; readonly label: string }[];
  readonly existingPeople: number;
  readonly totalPeople: number;
  readonly byModel: boolean;
  /** The version the fields publish as when the plan is approved. */
  readonly version: number;
  readonly setup: { readonly country: string | null; readonly countryName: string | null } | null;
}

/** What the file brought, for "From this file". */
export interface FileFacts {
  readonly rows: number;
  readonly columns: number;
  readonly mapped: number;
  /** Columns ignored on the mapping screen, by header. */
  readonly ignored: readonly string[];
}

export type Answer<T> =
  { readonly ok: true; readonly data: T } | { readonly ok: false; readonly message: string };

/** The proposals as the server checks them again: without what it only showed. */
export const proposalsOf = (view: NewFieldsView): ColumnProposal[] =>
  view.proposals.map(({ counts: _c, sensitive: _s, ...p }) => p);

/** Special category: held back unless HR says otherwise. */
export const isSpecial = (p: Pick<ColumnProposal, 'field'>): boolean =>
  p.field.classification === 'special-category';

const plural = (n: number, one: string, many: string): string =>
  `${n.toLocaleString('en-GB')} ${n === 1 ? one : many}`;

const TYPES: readonly DataType[] = [
  'text',
  'long_text',
  'number',
  'decimal',
  'date',
  'select',
  'boolean',
  'email',
  'phone',
  'bank_account',
];
const FILLERS: readonly WriterRole[] = ['employee', 'hr', 'manager', 'finance'];
const SEERS: readonly ViewerScope[] = ['self', 'manager', 'hr', 'finance', 'directory'];
const CLASSES: readonly Classification[] = [
  'public',
  'internal',
  'confidential',
  'special-category',
];
const CLASS_WORD: Record<Classification, string> = {
  public: 'Ordinary',
  internal: 'Ordinary',
  confidential: 'Confidential',
  'special-category': 'Special category',
};
const SEALABLE = new Set<DataType>([
  'text',
  'long_text',
  'email',
  'phone',
  'number',
  'decimal',
  'date',
  'bank_account',
]);

function sectionName(p: ColumnProposal, sections: NewFieldsView['sections']): string {
  return 'sectionKey' in p.placement
    ? (sections.find((s) => s.key === (p.placement as { sectionKey: string }).sectionKey)?.label ??
        p.placement.sectionKey)
    : `${p.placement.newSection} (new)`;
}

/** "XS, S, M, L, XL", "CC-100 … CC-160 (7 found)", or the shape in words. */
function optionsLine(p: ColumnProposal): string {
  const options = p.field.options ?? [];
  if (p.field.dataType !== 'select' || options.length === 0) return p.shape;
  return options.length <= 5
    ? options.join(', ')
    : `${options[0] ?? ''} … ${options.at(-1) ?? ''} (${String(options.length)} found)`;
}

/* ------------------------------------------------------- one proposal -- */

export interface ProposedFieldCardProps {
  readonly proposal: ColumnProposal;
  readonly sensitive: string | null;
  readonly counts: ColumnCounts | undefined;
  readonly rows: number;
  readonly sections: NewFieldsView['sections'];
  readonly newSections: readonly string[];
  readonly readOnly: boolean;
  readonly selected?: boolean;
  /** Under a finger the screen's own Skip and Create act for it (MA8): no "Import anyway" here. */
  readonly footless?: boolean;
  readonly onChange: (patch: Partial<ColumnProposal>) => void;
}

/**
 * One proposed field (the design's "Proposed field"): the column it comes
 * from, its name, a switch to keep it, then its type, section, who sees it and
 * how sensitive it is; or, held back, why. Edit opens the whole of it.
 */
export function ProposedFieldCard({
  proposal: p,
  sensitive,
  counts,
  rows,
  sections,
  newSections,
  readOnly,
  selected = false,
  footless = false,
  onChange,
}: ProposedFieldCardProps): JSX.Element {
  const [editing, setEditing] = useState(false);
  const id = useId();
  const f = p.field;
  const heldBack = isSpecial(p) && !p.include;
  const ringed = selected || editing;
  return (
    <Card
      padded
      aria-labelledby={`${id}-title`}
      className={
        ringed
          ? 'flex min-w-0 flex-col gap-3 ring-2 ring-accent'
          : heldBack
            ? 'flex min-w-0 flex-col gap-3 ring-[1.5px] ring-danger'
            : 'flex min-w-0 flex-col gap-3'
      }
    >
      <div className="flex items-center gap-2.5">
        <span className="font-mono text-xs text-fg-subtle">{p.header}</span>
        <icons.forward aria-hidden className="size-3.5 shrink-0 text-fg-subtle" />
        <h3 id={`${id}-title`} className="min-w-0 flex-1 text-base font-bold">
          {f.label}
        </h3>
        {isSpecial(p) ? (
          <Badge tone="danger" size="sm">
            <icons.sensitive aria-hidden />
            Sensitive
          </Badge>
        ) : null}
        {heldBack || readOnly ? null : (
          <Switch
            aria-label={`Create ${f.label}`}
            checked={p.include}
            onCheckedChange={(include) => {
              onChange({ include });
            }}
          />
        )}
      </div>
      {heldBack ? (
        <p className="text-sm text-fg-muted">{p.why}</p>
      ) : (
        <dl className="grid grid-cols-4 gap-2.5 touch:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-1.5">
            <dt className="text-2xs font-medium text-fg-subtle">Type</dt>
            <dd className="flex items-center gap-1 text-sm font-medium [&_svg]:size-3.5">
              <TypeIcon dataType={f.dataType} />
              {DATA_TYPE_LABEL[f.dataType]}
            </dd>
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <dt className="text-2xs font-medium text-fg-subtle">Section</dt>
            <dd className="text-sm font-medium">{sectionName(p, sections)}</dd>
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <dt className="text-2xs font-medium text-fg-subtle">Who sees it</dt>
            <dd>
              <AccessStrip audiences={AUDIENCES} value={accessOf(f.visibility, f.ownership)} />
            </dd>
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <dt className="text-2xs font-medium text-fg-subtle">Sensitivity</dt>
            <dd className="text-sm font-medium">{sensitive ?? CLASS_WORD[f.classification]}</dd>
          </div>
        </dl>
      )}
      <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
        {heldBack ? null : (
          <>
            <span className="inline-flex items-center gap-1 [&_svg]:size-3 [&_svg]:text-accent-fg">
              <icons.assistant aria-hidden />
              {p.confidence === 'high' ? 'High' : 'Medium'} confidence
            </span>
            <span aria-hidden>·</span>
            <span>{optionsLine(p)}</span>
            <span aria-hidden>·</span>
          </>
        )}
        <span>
          {counts === undefined
            ? `${plural(rows, 'row', 'rows')} in the file`
            : `${counts.have.toLocaleString('en-GB')} of ${plural(rows, 'row has', 'rows have')} a value`}
        </span>
        {readOnly ? null : (
          <span className="ms-auto">
            {heldBack && footless ? null : heldBack ? (
              <Button
                size="xs"
                variant="ghost"
                onClick={() => {
                  onChange({ include: true });
                }}
              >
                Import anyway
              </Button>
            ) : (
              <Button
                size="xs"
                variant="ghost"
                aria-expanded={editing}
                aria-controls={`${id}-edit`}
                onClick={() => {
                  setEditing((e) => !e);
                }}
              >
                {editing ? 'Done' : 'Edit'}
              </Button>
            )}
          </span>
        )}
      </div>
      {editing && !readOnly && !heldBack ? (
        <FieldEditor
          id={`${id}-edit`}
          proposal={p}
          sections={sections}
          newSections={newSections}
          onChange={onChange}
        />
      ) : null}
    </Card>
  );
}

/** Everything about a proposed field, to change before the plan. */
function FieldEditor({
  id,
  proposal: p,
  sections,
  newSections,
  onChange,
}: {
  readonly id: string;
  readonly proposal: ColumnProposal;
  readonly sections: NewFieldsView['sections'];
  readonly newSections: readonly string[];
  readonly onChange: (patch: Partial<ColumnProposal>) => void;
}): JSX.Element {
  const f = p.field;
  const set = (patch: Partial<NewField>): void => {
    onChange({ field: { ...f, ...patch } });
  };
  const placementValue =
    'sectionKey' in p.placement ? `s:${p.placement.sectionKey}` : `n:${p.placement.newSection}`;
  return (
    <div id={id} className="grid gap-4 border-t border-border pt-4 @2xl/page:grid-cols-2">
      <Field>
        <FieldLabel>Name</FieldLabel>
        <FieldControl>
          <Input
            value={f.label}
            onChange={(e) => {
              set({ label: e.target.value });
            }}
          />
        </FieldControl>
      </Field>
      <Field>
        <FieldLabel>Section</FieldLabel>
        <Select
          value={placementValue}
          onValueChange={(v) => {
            onChange({
              placement: v.startsWith('s:')
                ? { sectionKey: v.slice(2) }
                : { newSection: v.slice(2) },
            });
          }}
        >
          <FieldControl>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
          </FieldControl>
          <SelectContent>
            {sections.map((s) => (
              <SelectItem key={s.key} value={`s:${s.key}`}>
                {s.label}
              </SelectItem>
            ))}
            {newSections.map((n) => (
              <SelectItem key={n} value={`n:${n}`}>
                {n} (new section)
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field>
        <FieldLabel>Type</FieldLabel>
        <Select
          value={f.dataType}
          onValueChange={(v) => {
            set({ dataType: v as DataType, encrypted: f.encrypted && SEALABLE.has(v as DataType) });
          }}
        >
          <FieldControl>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
          </FieldControl>
          <SelectContent>
            {[...new Set([f.dataType, ...TYPES])].map((t) => (
              <SelectItem key={t} value={t}>
                {DATA_TYPE_LABEL[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldDescription>Values in the file: {p.shape}.</FieldDescription>
      </Field>
      {f.dataType === 'select' ? (
        <TagsInput
          label="Choices"
          hint="From the file. Add or remove any."
          value={f.options ?? []}
          onChange={(options) => {
            set({ options });
          }}
        />
      ) : null}
      <Field>
        <FieldLabel>Filled in by</FieldLabel>
        <ChipGroup
          type="multiple"
          aria-label={`Who fills in ${f.label}`}
          value={[...f.ownership]}
          onValueChange={(v: string[]) => {
            if (v.length > 0) set({ ownership: v as WriterRole[] });
          }}
        >
          {FILLERS.map((w) => (
            <ChipGroupItem key={w} value={w}>
              {WRITER_LABEL[w]}
            </ChipGroupItem>
          ))}
        </ChipGroup>
      </Field>
      <Field>
        <FieldLabel>Who sees it</FieldLabel>
        <ChipGroup
          type="multiple"
          aria-label={`Who sees ${f.label}`}
          value={[...f.visibility]}
          onValueChange={(v: string[]) => {
            set({ visibility: v as ViewerScope[] });
          }}
        >
          {SEERS.map((s) => (
            <ChipGroupItem key={s} value={s}>
              {SCOPE_LABEL[s]}
            </ChipGroupItem>
          ))}
        </ChipGroup>
      </Field>
      <Field>
        <FieldLabel>Sensitivity</FieldLabel>
        <Select
          value={f.classification}
          onValueChange={(v) => {
            const classification = v as Classification;
            set({
              classification,
              aiEligible:
                f.aiEligible && (classification === 'public' || classification === 'internal'),
            });
          }}
        >
          <FieldControl>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
          </FieldControl>
          <SelectContent>
            {CLASSES.map((c) => (
              <SelectItem key={c} value={c}>
                {c === 'public' ? 'Public' : CLASS_WORD[c]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <div className="flex flex-col gap-3">
        <Field orientation="horizontal" className="items-center justify-between gap-4">
          <FieldLabel>Store it encrypted</FieldLabel>
          <FieldControl>
            <Switch
              checked={f.encrypted}
              disabled={
                !SEALABLE.has(f.dataType) ||
                f.piiKind === 'financial' ||
                f.dataType === 'bank_account'
              }
              onCheckedChange={(on) => {
                set({ encrypted: on });
              }}
            />
          </FieldControl>
        </Field>
        <Field orientation="horizontal" className="items-center justify-between gap-4">
          <FieldLabel>The assistant may use it</FieldLabel>
          <FieldControl>
            <Switch
              checked={f.aiEligible}
              disabled={
                f.encrypted || !(f.classification === 'public' || f.classification === 'internal')
              }
              onCheckedChange={(on) => {
                set({ aiEligible: on });
              }}
            />
          </FieldControl>
        </Field>
        <Field orientation="horizontal" className="items-center justify-between gap-4">
          <FieldLabel>Required for new people</FieldLabel>
          <FieldControl>
            <Switch
              checked={f.required}
              onCheckedChange={(on) => {
                set({ required: on });
              }}
            />
          </FieldControl>
        </Field>
      </div>
    </div>
  );
}

/* --------------------------------------------------- AI9: new fields -- */

export const newSectionsOf = (proposals: readonly ColumnProposal[]): string[] => [
  ...new Set(
    proposals.flatMap((p) => ('newSection' in p.placement ? [p.placement.newSection] : [])),
  ),
];

/** "4 columns aren't fields yet. Here's what I'd create." */
/* ---------------------------------------- AI10: people without a value -- */

const CHOICE: Record<
  ForExisting['kind'],
  {
    /** `n` is "14 people"; `count` is "14". */
    readonly label: (n: string, count: string) => string;
    readonly short: string;
    readonly means: string;
  }
> = {
  ask: {
    label: (n) => `Ask the ${n} to fill it in`,
    short: 'Ask them',
    means:
      'It’s theirs to fill in, and the weekly reminder asks for it. Until they do, they show as incomplete.',
  },
  hr: {
    label: (_n, count) => `HR fills in the ${count}`,
    short: 'HR fills it in',
    means:
      'They go to the Data health grid, for HR. It’s required, so they show as incomplete until then.',
  },
  new: {
    label: () => 'Only ask people who join from now on',
    short: 'Only new joiners',
    means: 'Nobody here now is asked. New joiners are asked for it.',
  },
  leave: {
    label: () => 'Leave it empty',
    short: 'Leave it empty',
    means: 'It’s optional, and nobody is asked.',
  },
  default: {
    label: (_n, count) => `Give the ${count} the file’s value`,
    short: 'The file’s value',
    means: 'Every row of the file holds the same value, so it’s written for them too.',
  },
};

function impactOf(kind: ForExisting['kind'], n: number): string {
  if (n === 0) return 'Nothing to do';
  switch (kind) {
    case 'ask':
      return `${plural(n, 'person', 'people')} asked · incomplete until they answer`;
    case 'hr':
      return `${plural(n, 'cell', 'cells')} for HR`;
    case 'new':
      return 'Nobody asked today';
    case 'leave':
      return 'Nobody asked';
    case 'default':
      return `${plural(n, 'value', 'values')} written`;
  }
}

/**
 * What happens for the people without a value, as one inline choice: the
 * import's review keeps each field to a line.
 */
export function MissingChoice({
  proposal: p,
  missing,
  recommended,
  readOnly,
  onChange,
}: {
  readonly proposal: ColumnProposal;
  readonly missing: number;
  readonly recommended: ForExisting['kind'] | null;
  readonly readOnly: boolean;
  readonly onChange: (forExisting: ForExisting) => void;
}): JSX.Element {
  const single = p.forExisting.kind === 'default' ? p.forExisting.value : null;
  const kinds: ForExisting['kind'][] = [
    'ask',
    'hr',
    'new',
    'leave',
    ...(recommended === 'default' || single !== null ? (['default'] as const) : []),
  ];
  return (
    <Field orientation="horizontal">
      <FieldLabel>
        {plural(missing, 'person has', 'people have')} no {p.field.label}
      </FieldLabel>
      <FieldControl>
        <Select
          value={p.forExisting.kind}
          disabled={readOnly}
          onValueChange={(kind) => {
            onChange(
              kind === 'default'
                ? { kind: 'default', value: single ?? '' }
                : ({ kind } as ForExisting),
            );
          }}
        >
          <SelectTrigger
            aria-label={`What happens for the people without ${p.field.label}`}
            size="sm"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {kinds.map((kind) => (
              <SelectItem key={kind} value={kind}>
                {CHOICE[kind].short}
                {kind === recommended ? ' (suggested)' : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FieldControl>
      <FieldDescription>{impactOf(p.forExisting.kind, missing)}</FieldDescription>
    </Field>
  );
}
