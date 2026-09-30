import {
  Alert,
  AssistantMark,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ChipGroup,
  ChipGroupItem,
  Field,
  FieldControl,
  FieldDescription,
  FieldLabel,
  Input,
  RadioCard,
  RadioGroup,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Stack,
  Switch,
  TagsInput,
} from '@reach/ui';
import { useState, type JSX } from 'react';

import type { Outcome } from '../load';
import {
  CLASSIFICATION_LABEL,
  DATA_TYPE_LABEL,
  SCOPE_LABEL,
  WRITER_LABEL,
  inSentence,
  listed,
} from '../settings/words';
import type { Classification, DataType, PiiKind, ViewerScope, WriterRole } from '../settings/model';

/**
 * New information in this file (docs/ai-settings.md): the columns that match
 * no field, proposed as fields, and what happens for the people already here
 * whom the file gives no value. Three steps, then one OK.
 *
 * Nothing here decides: People proposes (with the assistant, from headers
 * and the shape of the values, never the values), HR edits, and People checks
 * the lot again and adds it in one transaction, or not at all. Existing
 * fields are never changed. HR without administrator rights sees the whole
 * proposal and is told an administrator has to add it.
 */

export type ForExisting =
  | { readonly kind: 'ask' }
  | { readonly kind: 'hr' }
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
}

export interface NewFieldsView {
  readonly canCreate: boolean;
  readonly blocked: string | null;
  readonly proposals: readonly (ColumnProposal & {
    readonly counts: { readonly fromFile: number; readonly existingWithout: number };
    readonly sensitive: string | null;
  })[];
  readonly sections: readonly { readonly key: string; readonly label: string }[];
  readonly existingPeople: number;
  readonly byModel: boolean;
  readonly summary: string;
}

export type Reviewed = NewFieldsView & {
  readonly problems: readonly { readonly column: number; readonly message: string }[];
};

export type Answer<T> =
  { readonly ok: true; readonly data: T } | { readonly ok: false; readonly message: string };

export interface NewInformationProps {
  readonly view: NewFieldsView;
  readonly onReview: (proposals: readonly ColumnProposal[]) => Promise<Answer<Reviewed>>;
  /** Add, publish, write the defaults; then the import goes on with these columns mapped. */
  readonly onApply: (proposals: readonly ColumnProposal[], summary: string) => Promise<Outcome>;
  /** Go on without the new columns. */
  readonly onSkip: () => void;
  readonly onBack: () => void;
}

type Step = 'fields' | 'existing' | 'review';

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

const plural = (n: number, one: string, many: string): string =>
  `${n.toLocaleString('en-GB')} ${n === 1 ? one : many}`;

export function NewInformation({
  view,
  onReview,
  onApply,
  onSkip,
  onBack,
}: NewInformationProps): JSX.Element {
  const [step, setStep] = useState<Step>('fields');
  const [proposals, setProposals] = useState<readonly ColumnProposal[]>(() =>
    view.proposals.map(({ counts: _c, sensitive: _s, ...p }) => p),
  );
  const [reviewed, setReviewed] = useState<Reviewed | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const kept = proposals.filter((p) => p.include);
  const readOnly = !view.canCreate;
  const countOf = (column: number) => view.proposals.find((p) => p.column === column)?.counts;
  const sensitiveOf = (column: number) =>
    view.proposals.find((p) => p.column === column)?.sensitive ?? null;
  const change = (column: number, patch: Partial<ColumnProposal>): void => {
    setProposals((list) => list.map((p) => (p.column === column ? { ...p, ...patch } : p)));
  };
  const newSections = [
    ...new Set(
      proposals.flatMap((p) => ('newSection' in p.placement ? [p.placement.newSection] : [])),
    ),
  ];

  const review = async (): Promise<void> => {
    setBusy(true);
    setFailed(null);
    const answer = await onReview(proposals);
    setBusy(false);
    if (!answer.ok) {
      setFailed(answer.message);
      return;
    }
    setReviewed(answer.data);
    setStep('review');
  };

  return (
    <Stack gap={4}>
      <div className="flex items-start gap-3">
        <AssistantMark />
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="text-lg font-semibold">
            {step === 'fields'
              ? 'New information in this file'
              : step === 'existing'
                ? 'People not in this file'
                : 'Review before anything is added'}
          </h2>
          <p className="text-sm text-fg-muted">
            {step === 'fields'
              ? `${plural(proposals.length, 'column matches', 'columns match')} no field. ${view.byModel ? 'The assistant' : 'People'} proposes a field for each, from the column’s name and the shape of its values; the values themselves are never sent to the assistant. Change anything, or leave a column out.`
              : step === 'existing'
                ? `${plural(view.existingPeople, 'person is', 'people are')} already here. For each new field, what happens for the ones this file gives no value?`
                : 'Nothing is added until you press the button below. Existing fields are not changed.'}
          </p>
        </div>
      </div>
      {view.blocked === null ? null : (
        <Alert
          tone={readOnly ? 'info' : 'warning'}
          title={readOnly ? 'An administrator adds fields' : 'Not yet'}
        >
          {view.blocked}
        </Alert>
      )}
      {failed === null ? null : (
        <Alert tone="danger" title="That did not go through">
          {failed}
        </Alert>
      )}

      {step === 'fields'
        ? proposals.map((p) => (
            <ColumnCard
              key={p.column}
              proposal={p}
              sensitive={sensitiveOf(p.column)}
              sections={view.sections}
              newSections={newSections}
              readOnly={readOnly}
              onChange={(patch) => {
                change(p.column, patch);
              }}
            />
          ))
        : null}

      {step === 'existing'
        ? kept.map((p) => (
            <ExistingCard
              key={p.column}
              proposal={p}
              without={countOf(p.column)?.existingWithout ?? 0}
              recommended={
                view.proposals.find((x) => x.column === p.column)?.forExisting.kind ?? null
              }
              readOnly={readOnly}
              onChange={(forExisting) => {
                change(p.column, { forExisting });
              }}
            />
          ))
        : null}

      {step === 'review' && reviewed !== null ? (
        <Card>
          <CardContent className="flex flex-col gap-3 pt-5">
            <p>{reviewed.summary}</p>
            {kept.some((p) => sensitiveOf(p.column) !== null) ? (
              <p className="text-sm">
                Sensitive:{' '}
                {listed(
                  kept.filter((p) => sensitiveOf(p.column) !== null).map((p) => p.field.label),
                )}
                . They are stored{' '}
                {kept.some((p) => p.field.encrypted) ? 'encrypted where marked, ' : ''}seen only by
                the people chosen, and never shown to the assistant.
              </p>
            ) : null}
            {reviewed.problems.length === 0 ? null : (
              <Alert tone="danger" title="These would be refused">
                <ul className="list-disc ps-5">
                  {reviewed.problems.map((x) => (
                    <li key={x.column}>
                      {proposals.find((p) => p.column === x.column)?.header}: {x.message}
                    </li>
                  ))}
                </ul>
              </Alert>
            )}
          </CardContent>
        </Card>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        {step === 'fields' ? (
          <>
            <Button onClick={onBack}>Back to mapping</Button>
            <Button onClick={onSkip}>Import without these columns</Button>
            <Button
              variant="primary"
              disabled={kept.length === 0}
              onClick={() => {
                setStep('existing');
              }}
            >
              Next: people not in this file
            </Button>
          </>
        ) : step === 'existing' ? (
          <>
            <Button
              onClick={() => {
                setStep('fields');
              }}
            >
              Back
            </Button>
            <Button
              variant="primary"
              loading={busy}
              loadingLabel="Checking"
              onClick={() => void review()}
            >
              Review
            </Button>
          </>
        ) : (
          <>
            <Button
              onClick={() => {
                setStep('existing');
              }}
            >
              Back
            </Button>
            <Button onClick={onSkip}>Import without these columns</Button>
            {readOnly ? null : (
              <Button
                variant="primary"
                loading={busy}
                loadingLabel="Adding the fields"
                disabled={view.blocked !== null || (reviewed?.problems.length ?? 0) > 0}
                onClick={() => {
                  void (async () => {
                    setBusy(true);
                    setFailed(null);
                    const done = await onApply(proposals, reviewed?.summary ?? view.summary);
                    setBusy(false);
                    if (!done.ok) setFailed(done.message);
                  })();
                }}
              >
                Add {plural(kept.length, 'field', 'fields')} and continue
              </Button>
            )}
          </>
        )}
      </div>
    </Stack>
  );
}

/** One column, as a readable proposal, with its controls a click away. */
function ColumnCard({
  proposal: p,
  sensitive,
  sections,
  newSections,
  readOnly,
  onChange,
}: {
  readonly proposal: ColumnProposal;
  readonly sensitive: string | null;
  readonly sections: NewFieldsView['sections'];
  readonly newSections: readonly string[];
  readonly readOnly: boolean;
  readonly onChange: (patch: Partial<ColumnProposal>) => void;
}): JSX.Element {
  const [editing, setEditing] = useState(false);
  const f = p.field;
  const set = (patch: Partial<NewField>): void => {
    onChange({ field: { ...f, ...patch } });
  };
  const sectionName =
    'sectionKey' in p.placement
      ? (sections.find((s) => s.key === (p.placement as { sectionKey: string }).sectionKey)
          ?.label ?? p.placement.sectionKey)
      : `${p.placement.newSection} (new section)`;
  const placementValue =
    'sectionKey' in p.placement ? `s:${p.placement.sectionKey}` : `n:${p.placement.newSection}`;
  const id = `column-${String(p.column)}`;
  return (
    <Card aria-labelledby={`${id}-title`}>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <CardTitle id={`${id}-title`}>
            “{p.header}” → {f.label}
          </CardTitle>
          <p className="text-sm text-fg-muted">
            {p.shape} · {p.why}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {sensitive === null ? null : <Badge tone="sensitive">{sensitive}</Badge>}
          {p.include ? null : <Badge>Not imported</Badge>}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <dl className="grid grid-cols-[8rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm touch:grid-cols-1">
          <dt className="text-fg-muted">Section</dt>
          <dd>{sectionName}</dd>
          <dt className="text-fg-muted">Type</dt>
          <dd>
            {DATA_TYPE_LABEL[f.dataType]}
            {f.options?.length ? `: ${f.options.join(', ')}` : ''}
            {f.country ? ` (${f.country})` : ''}
          </dd>
          <dt className="text-fg-muted">Filled in by</dt>
          <dd className="first-letter:uppercase">
            {listed(f.ownership.map((w) => inSentence(WRITER_LABEL[w])))}
          </dd>
          <dt className="text-fg-muted">Seen by</dt>
          <dd className="first-letter:uppercase">
            {f.visibility.length === 0
              ? 'nobody individually'
              : listed(f.visibility.map((s) => inSentence(SCOPE_LABEL[s])))}
          </dd>
          <dt className="text-fg-muted">Protection</dt>
          <dd>
            {CLASSIFICATION_LABEL[f.classification].label}
            {f.encrypted ? ' · encrypted' : ''}
            {f.aiEligible ? ' · the assistant may use it' : ' · never shown to the assistant'}
          </dd>
          <dt className="text-fg-muted">Required</dt>
          <dd>{f.required ? 'Yes, for people added from now on' : 'No'}</dd>
        </dl>
        {readOnly ? null : (
          <div className="flex flex-wrap gap-3">
            <Button
              size="sm"
              aria-expanded={editing}
              aria-controls={`${id}-edit`}
              onClick={() => {
                setEditing((e) => !e);
              }}
            >
              {editing ? 'Done' : `Change ${f.label}`}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                onChange({ include: !p.include });
              }}
            >
              {p.include ? 'Don’t import this column' : 'Import this column'}
            </Button>
          </div>
        )}
        {editing && !readOnly ? (
          <div id={`${id}-edit`} className="grid gap-4 sm:grid-cols-2">
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
                <SelectTrigger aria-label={`Section for ${f.label}`}>
                  <SelectValue />
                </SelectTrigger>
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
                  set({
                    dataType: v as DataType,
                    encrypted: f.encrypted && SEALABLE.has(v as DataType),
                  });
                }}
              >
                <SelectTrigger aria-label={`Type of ${f.label}`}>
                  <SelectValue />
                </SelectTrigger>
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
              <FieldLabel>Who can see it</FieldLabel>
              <ChipGroup
                type="multiple"
                aria-label={`Who can see ${f.label}`}
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
              <FieldLabel>How sensitive</FieldLabel>
              <Select
                value={f.classification}
                onValueChange={(v) => {
                  const classification = v as Classification;
                  set({
                    classification,
                    aiEligible:
                      f.aiEligible &&
                      (classification === 'public' || classification === 'internal'),
                  });
                }}
              >
                <SelectTrigger aria-label={`How sensitive ${f.label} is`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CLASSES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {CLASSIFICATION_LABEL[c].label}
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
                      f.encrypted ||
                      !(f.classification === 'public' || f.classification === 'internal')
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
        ) : null}
      </CardContent>
    </Card>
  );
}

const CHOICES: readonly {
  readonly kind: ForExisting['kind'];
  readonly label: string;
  readonly means: string;
}[] = [
  {
    kind: 'ask',
    label: 'Ask them to fill it in',
    means: 'It becomes theirs to complete, with the usual reminders.',
  },
  { kind: 'hr', label: 'HR will fill it in', means: 'It goes on HR’s completeness list.' },
  {
    kind: 'leave',
    label: 'Leave it empty',
    means: 'Nobody is chased. If it is required, only for people added from now on.',
  },
  {
    kind: 'default',
    label: 'Use one value for everyone missing it',
    means: 'Written now, for each of them.',
  },
];

function ExistingCard({
  proposal: p,
  without,
  recommended,
  readOnly,
  onChange,
}: {
  readonly proposal: ColumnProposal;
  readonly without: number;
  readonly recommended: ForExisting['kind'] | null;
  readonly readOnly: boolean;
  readonly onChange: (forExisting: ForExisting) => void;
}): JSX.Element {
  const id = `existing-${String(p.column)}`;
  const value = p.forExisting.kind === 'default' ? p.forExisting.value : '';
  return (
    <Card aria-labelledby={`${id}-title`}>
      <CardHeader>
        <CardTitle id={`${id}-title`}>{p.field.label}</CardTitle>
        <p className="text-sm text-fg-muted">
          {without === 0
            ? 'Everybody already here gets a value from this file.'
            : `${plural(without, 'person here gets', 'people here get')} no value from this file.`}
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <RadioGroup
          aria-labelledby={`${id}-title`}
          value={p.forExisting.kind}
          disabled={readOnly}
          onValueChange={(kind) => {
            onChange(kind === 'default' ? { kind: 'default', value } : ({ kind } as ForExisting));
          }}
          className="grid gap-2 sm:grid-cols-2"
        >
          {CHOICES.map((c) => (
            <RadioCard
              key={c.kind}
              value={c.kind}
              description={
                c.kind === recommended ? `${c.means} Recommended: ${p.forExistingWhy}` : c.means
              }
            >
              {c.label}
            </RadioCard>
          ))}
        </RadioGroup>
        {p.forExisting.kind === 'default' ? (
          <Field>
            <FieldLabel>Value for everyone missing it</FieldLabel>
            <FieldControl>
              <Input
                value={value}
                disabled={readOnly}
                onChange={(e) => {
                  onChange({ kind: 'default', value: e.target.value });
                }}
              />
            </FieldControl>
          </Field>
        ) : null}
      </CardContent>
    </Card>
  );
}
