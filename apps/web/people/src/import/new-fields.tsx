import {
  AccessStrip,
  Alert,
  AssistantCard,
  Badge,
  Button,
  Card,
  Carousel,
  ChipGroup,
  ChipGroupItem,
  DataTable,
  Field,
  FieldControl,
  FieldDescription,
  FieldLabel,
  Input,
  KeyValues,
  PageSection,
  RadioCard,
  RadioGroup,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  TagsInput,
  icons,
  type DataColumn,
} from '@reach/ui';
import { useId, useState, type JSX } from 'react';

import { AUDIENCES, TypeIcon, accessOf } from '../settings/access';
import type { Classification, DataType, PiiKind, ViewerScope, WriterRole } from '../settings/model';
import { DATA_TYPE_LABEL, SCOPE_LABEL, WRITER_LABEL } from '../settings/words';

/**
 * The import's "New fields" step (design AI9, AI10; on a phone MA8, MA9):
 * the columns that match no field, proposed as fields, and what happens for
 * the people who will have no value.
 *
 * Nothing here decides. People proposes (with the assistant, from the
 * columns' headers and the shape of their values, never a value), HR switches
 * each on or off and edits it, and the plan that follows says what approving
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
  /** The file's own rows without a value, by name: the first twenty. */
  readonly without?: readonly string[];
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

export interface NewFieldsStepProps {
  readonly view: NewFieldsView;
  readonly proposals: readonly ColumnProposal[];
  readonly facts: FileFacts;
  readonly onChange: (column: number, patch: Partial<ColumnProposal>) => void;
  /** Under a finger: one card at a time (MA8), with the card the URL names. */
  readonly coarse: boolean;
  readonly index: number;
  readonly onIndexChange: (index: number) => void;
}

const newSectionsOf = (proposals: readonly ColumnProposal[]): string[] => [
  ...new Set(
    proposals.flatMap((p) => ('newSection' in p.placement ? [p.placement.newSection] : [])),
  ),
];

/** "4 columns aren't fields yet. Here's what I'd create." */
export function NewFieldsStep({
  view,
  proposals,
  facts,
  onChange,
  coarse,
  index,
  onIndexChange,
}: NewFieldsStepProps): JSX.Element {
  const readOnly = !view.canCreate;
  const acceptable = proposals.filter((p) => !isSpecial(p));
  const kept = proposals.filter((p) => p.include);
  const newSections = newSectionsOf(proposals);
  const n = proposals.length;
  const card = (p: ColumnProposal, selected = false): JSX.Element => {
    const shown = view.proposals.find((x) => x.column === p.column);
    return (
      <ProposedFieldCard
        key={p.column}
        proposal={p}
        sensitive={shown?.sensitive ?? null}
        counts={shown?.counts}
        rows={facts.rows}
        sections={view.sections}
        newSections={newSections}
        readOnly={readOnly}
        selected={selected}
        footless={coarse}
        onChange={(patch) => {
          onChange(p.column, patch);
        }}
      />
    );
  };
  const notImported = [
    ...facts.ignored,
    ...proposals.filter((p) => !p.include).map((p) => p.header),
  ];
  const assistantNote = view.byModel
    ? null
    : 'Proposed by Kithena’s own rules: the assistant didn’t answer this time.';
  const alerts = (
    <>
      {view.blocked === null ? null : (
        <Alert
          tone={readOnly ? 'info' : 'warning'}
          title={readOnly ? 'An administrator adds fields' : 'Not yet'}
        >
          {view.blocked}
        </Alert>
      )}
    </>
  );

  if (coarse) {
    // MA8: one proposed field per card, swiped through; Skip and Create below.
    return (
      <div className="flex flex-col gap-3">
        <AssistantCard
          level={2}
          title={n === 1 ? 'This column isn’t a field yet' : 'These columns aren’t fields yet'}
          {...(assistantNote === null ? {} : { note: assistantNote })}
        >
          <p className="text-sm text-fg-muted">
            Swipe through. I’ve designed each one from the data.
          </p>
        </AssistantCard>
        {alerts}
        <Carousel
          label="Proposed fields"
          controls="dots"
          itemClassName="w-full"
          index={index}
          onIndexChange={onIndexChange}
        >
          {proposals.map((p) => card(p))}
        </Carousel>
      </div>
    );
  }

  return (
    <div className="grid items-start gap-4 @4xl/page:grid-cols-[minmax(0,1fr)_21.25rem]">
      <div className="flex min-w-0 flex-col gap-3">
        <AssistantCard
          level={2}
          title={
            n === 1
              ? '1 column isn’t a field yet. Here’s what I’d create.'
              : `${String(n)} columns aren’t fields yet. Here’s what I’d create.`
          }
          action={
            readOnly || acceptable.length === 0 ? undefined : (
              <Button
                size="sm"
                variant="primary"
                startIcon={<icons.confirm aria-hidden />}
                onClick={() => {
                  for (const p of acceptable) onChange(p.column, { include: true });
                }}
              >
                Accept all {acceptable.length}
              </Button>
            )
          }
          {...(assistantNote === null ? {} : { note: assistantNote })}
        >
          <p className="text-sm text-fg-muted">
            I read every value in each column to choose the type, the options and who should see it.
            Switch off any you don’t want, or edit them.
          </p>
        </AssistantCard>
        {alerts}
        {proposals.map((p) => card(p))}
      </div>
      <div className="flex flex-col gap-3.5">
        <PageSection surface title="From this file">
          <KeyValues
            items={[
              { label: 'Columns', value: facts.columns },
              { label: 'Matched to fields', value: facts.mapped },
              { label: 'New fields suggested', value: kept.length },
              {
                label: 'Not imported',
                value:
                  notImported.length === 0
                    ? 'None'
                    : `${String(notImported.length)} (${notImported.join(', ')})`,
              },
            ]}
          />
        </PageSection>
        <Alert
          tone="info"
          title={view.setup === null ? 'These become a draft in Settings' : 'These come with setup'}
        >
          {view.setup === null
            ? `They’re added to Employee fields as draft version ${String(view.version)}. Nothing is published until you approve the plan.`
            : `They’re published with ${view.setup.countryName === null ? 'the fields every company has' : `the ${view.setup.countryName} pack`} as version 1. Nothing is published until you approve the plan.`}
        </Alert>
      </div>
    </div>
  );
}

/* ---------------------------------------- AI10: people without a value -- */

const CHOICE: Record<
  ForExisting['kind'],
  {
    /** `n` is "14 people"; `count` is "14". */
    readonly label: (n: string, count: string) => string;
    readonly means: (count: string) => string;
    /** On a phone (MA9): a word or two, and what it does in a line. */
    readonly short: string;
    readonly shortMeans: string;
  }
> = {
  // An ask is required: they show as incomplete until they answer (an optional ask is PEO-148).
  ask: {
    label: (n) => `Ask the ${n} to fill it in`,
    means: () =>
      'It shows on their profile as missing, and the weekly reminder asks for it. Until they answer, they show as incomplete.',
    short: 'Ask them',
    shortMeans: 'They show as incomplete',
  },
  new: {
    label: () => 'Only ask people who join from now on',
    means: (count) => `The ${count} stay empty. New joiners are asked in onboarding.`,
    short: 'Only new joiners',
    shortMeans: 'Nobody asked today',
  },
  hr: {
    label: (_n, count) => `HR fills in the ${count}`,
    means: () => 'They go to the Data health grid, for HR.',
    short: 'HR fills it in',
    shortMeans: 'In Data health, for HR',
  },
  leave: {
    label: () => 'Leave it empty',
    means: () => 'It’s optional, and nobody is asked.',
    short: 'Leave it empty',
    shortMeans: 'Nobody is asked',
  },
  default: {
    label: (_n, count) => `Give the ${count} the file’s value`,
    means: () => 'Every row of the file holds the same value, so it’s written for them too.',
    short: 'The file’s value',
    shortMeans: 'Written for them',
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

/** The same on a phone (MA9): a count and a word, beside the one-line meaning. */
function shortImpactOf(kind: ForExisting['kind'], n: number): string {
  if (n === 0) return 'Nothing to do';
  const count = n.toLocaleString('en-GB');
  switch (kind) {
    case 'ask':
      return `${count} incomplete`;
    case 'hr':
      return `${count} for HR`;
    case 'new':
    case 'leave':
      return 'Nothing to do today';
    case 'default':
      return `${count} written`;
  }
}

/** What happens for a field's people without a value, as a short word: the table's last column. */
export function planWord(p: ColumnProposal, missing: number): string {
  if (missing === 0) return 'Nothing to do';
  switch (p.forExisting.kind) {
    case 'ask':
      return `Ask the ${plural(missing, 'person', 'people')}`;
    case 'hr':
      return 'HR fills it in';
    case 'new':
      return 'Only new joiners';
    case 'leave':
      return 'Left empty';
    case 'default':
      return `“${p.forExisting.value}” for them`;
  }
}

/** The choices for one field, each with what it does (`RadioCard` with impact). */
export function ExistingChoices({
  proposal: p,
  missing,
  recommended,
  readOnly,
  compact = false,
  onChange,
}: {
  readonly proposal: ColumnProposal;
  readonly missing: number;
  readonly recommended: ForExisting['kind'] | null;
  readonly readOnly: boolean;
  /** The phone's three, in a word each (MA9). */
  readonly compact?: boolean;
  readonly onChange: (forExisting: ForExisting) => void;
}): JSX.Element {
  const single = p.forExisting.kind === 'default' ? p.forExisting.value : null;
  const recommendedDefault = recommended === 'default' ? (single ?? undefined) : undefined;
  // The design's order: ask, only new joiners, HR; then what the backend adds.
  const kinds: ForExisting['kind'][] = [
    'ask',
    'new',
    'hr',
    'leave',
    ...(recommended === 'default' || single !== null ? (['default'] as const) : []),
  ];
  const n = plural(missing, 'person', 'people');
  const shown = compact ? kinds.filter((k) => k !== 'hr' || recommended === 'hr') : kinds;
  return (
    <RadioGroup
      aria-label={`What happens for the people without ${p.field.label}`}
      value={p.forExisting.kind}
      disabled={readOnly}
      onValueChange={(kind) => {
        onChange(
          kind === 'default'
            ? { kind: 'default', value: single ?? recommendedDefault ?? '' }
            : ({ kind } as ForExisting),
        );
      }}
      className="flex flex-col gap-2"
    >
      {shown.map((kind) => (
        <RadioCard
          key={kind}
          value={kind}
          description={
            compact ? CHOICE[kind].shortMeans : CHOICE[kind].means(missing.toLocaleString('en-GB'))
          }
          impact={compact ? shortImpactOf(kind, missing) : impactOf(kind, missing)}
          {...(kind === recommended
            ? {
                badge: (
                  <Badge tone="assistant" size="sm">
                    Suggested
                  </Badge>
                ),
              }
            : {})}
        >
          {compact ? CHOICE[kind].short : CHOICE[kind].label(n, missing.toLocaleString('en-GB'))}
        </RadioCard>
      ))}
    </RadioGroup>
  );
}

/** Who has no value for a field, by name: the file's rows first, then how many already here. */
export function WithoutValue({
  label,
  names,
  missing,
  here,
}: {
  readonly label: string;
  readonly names: readonly string[];
  readonly missing: number;
  /** People already here whom the file doesn't reach. */
  readonly here: number;
}): JSX.Element | null {
  if (missing === 0) return null;
  // The table names the first twenty of the file's rows; the rest are counted.
  const inFile = Math.max(0, missing - here - names.length);
  const rest = [
    inFile > 0 ? `${plural(inFile, 'more person', 'more people')} in the file` : null,
    here > 0
      ? `${plural(here, 'person', 'people')} already here, whom the file doesn’t reach`
      : null,
  ].filter((x) => x !== null);
  return (
    <div className="flex flex-col gap-2">
      {names.length === 0 ? null : (
        <DataTable
          label={`People without ${label}`}
          rows={names.map((name, i) => ({ id: `${String(i)} ${name}`, name }))}
          columns={[{ id: 'name', header: 'Name', cell: (r) => r.name }]}
          rowId={(r) => r.id}
          dense
        />
      )}
      {rest.length > 0 ? (
        <p className="text-sm text-fg-muted">
          {names.length === 0 ? '' : 'And '}
          {rest.join(', and ')}.
        </p>
      ) : null}
    </div>
  );
}

export interface ExistingStepProps {
  readonly view: NewFieldsView;
  /** The proposals HR kept. */
  readonly kept: readonly ColumnProposal[];
  /** The field the URL names, else the first that needs a decision. */
  readonly selected: string | null;
  readonly onSelect: (key: string) => void;
  readonly onChange: (column: number, patch: Partial<ColumnProposal>) => void;
}

/** "Most people already have a value from the file" (design AI10). */
export function ExistingStep({
  view,
  kept,
  selected,
  onSelect,
  onChange,
}: ExistingStepProps): JSX.Element {
  const readOnly = !view.canCreate;
  const missingOf = (p: ColumnProposal): number =>
    view.proposals.find((x) => x.column === p.column)?.counts.missing ?? 0;
  const haveOf = (p: ColumnProposal): number =>
    view.proposals.find((x) => x.column === p.column)?.counts.have ?? 0;
  const withoutOf = (p: ColumnProposal): readonly string[] =>
    view.proposals.find((x) => x.column === p.column)?.counts.without ?? [];
  const current =
    kept.find((p) => p.key === selected) ?? kept.find((p) => missingOf(p) > 0) ?? kept[0];
  const recommended = (p: ColumnProposal): ForExisting['kind'] | null =>
    view.proposals.find((x) => x.column === p.column)?.forExisting.kind ?? null;
  const most = kept.every((p) => haveOf(p) >= missingOf(p));
  const total = view.totalPeople;
  const columns: DataColumn<ColumnProposal>[] = [
    {
      id: 'field',
      header: 'Field',
      cell: (p) => <span className="font-semibold">{p.field.label}</span>,
    },
    {
      id: 'have',
      header: 'Have it',
      cell: (p) => `${haveOf(p).toLocaleString('en-GB')} of ${total.toLocaleString('en-GB')}`,
    },
    {
      id: 'missing',
      header: 'Missing',
      cell: (p) =>
        missingOf(p) === 0 ? (
          <span className="text-fg-subtle">—</span>
        ) : (
          <span className="font-medium text-warning-fg">
            {missingOf(p).toLocaleString('en-GB')} missing
          </span>
        ),
    },
    {
      id: 'plan',
      header: 'What happens',
      cell: (p) => <span className="font-medium">{planWord(p, missingOf(p))}</span>,
    },
    {
      // Each row opens its choices beside the table (design AI10's chevron).
      id: 'open',
      header: <span className="sr-only">Choose</span>,
      cell: () => <icons.next aria-hidden className="size-4 text-fg-subtle" />,
    },
  ];
  return (
    <div className="grid items-start gap-4 @4xl/page:grid-cols-2">
      <div className="flex min-w-0 flex-col gap-3">
        <AssistantCard
          level={2}
          title={
            most
              ? 'Most people already have a value from the file'
              : 'Many people won’t have a value from the file'
          }
        >
          <p className="text-sm text-fg-muted">
            For the people who don’t, I’ve picked the gentlest option that still gets the data.
            Change any of them.
          </p>
        </AssistantCard>
        {kept.length === 0 ? (
          <Alert tone="info" title="No new fields">
            Every new column is switched off, so the file imports without them.
          </Alert>
        ) : (
          <DataTable
            label="New fields and the people without a value"
            rows={kept}
            columns={columns}
            rowId={(p) => p.key}
            activeRowId={current?.key ?? null}
            onRowClick={(p) => {
              onSelect(p.key);
            }}
            describeRow={(p) => p.field.label}
          />
        )}
      </div>
      {current === undefined ? null : (
        <PageSection
          surface
          title={`${current.field.label} · ${plural(missingOf(current), 'person', 'people')} without a value`}
        >
          <div className="flex flex-col gap-3">
            <ExistingChoices
              proposal={current}
              missing={missingOf(current)}
              recommended={recommended(current)}
              readOnly={readOnly}
              onChange={(forExisting) => {
                onChange(current.column, { forExisting });
              }}
            />
            {current.forExisting.kind === 'default' ? (
              <Field>
                <FieldLabel>Value for the people without one</FieldLabel>
                <FieldControl>
                  <Input
                    value={current.forExisting.value}
                    disabled={readOnly}
                    onChange={(e) => {
                      onChange(current.column, {
                        forExisting: { kind: 'default', value: e.target.value },
                      });
                    }}
                  />
                </FieldControl>
              </Field>
            ) : null}
            <p className="text-sm text-fg-muted">Why this suggestion: {current.forExistingWhy}</p>
            <WithoutValue
              label={current.field.label}
              names={withoutOf(current)}
              missing={missingOf(current)}
              here={
                view.proposals.find((x) => x.column === current.column)?.counts.existingWithout ?? 0
              }
            />
          </div>
        </PageSection>
      )}
    </div>
  );
}
