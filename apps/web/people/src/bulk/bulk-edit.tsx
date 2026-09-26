import {
  Alert,
  AutoGrid,
  Badge,
  Button,
  Card,
  Checkbox,
  DataTable,
  DatePicker,
  EmptyState,
  Field,
  FieldControl,
  FieldDescription,
  FieldLabel,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Stack,
  Stat,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  useBreakpoint,
  type DataColumn,
} from '@reach/ui';
import { useState, type JSX } from 'react';

import { Loaded, type IdentifierFinding, type Loadable } from '../load';
import { AttributeInput, PeopleSearch, type SearchPeople } from '../record/attribute-input';
import { DisplayValue } from '../record/display';
import type { AttributeValue, RecordField, RecordSection } from '../record/model';

export interface BulkEditState {
  /** The people chosen, by name. */
  readonly people: readonly { readonly id: string; readonly name: string }[];
  /** What HR may set on them: writable, and not a lifecycle date. */
  readonly sections: readonly RecordSection[];
  /** The default date the change takes effect from. */
  readonly today: string;
  /** People per request: a larger selection is sent a page at a time. */
  readonly limit: number;
}

/** A page of a bulk edit: the same values for these people, from one date. */
export interface BulkEditPage {
  readonly personIds: readonly string[];
  readonly values: Readonly<Record<string, AttributeValue>>;
  readonly effectiveFrom: string;
  /** HR writes values that need approval straight through, recorded as such (PEO-077). */
  readonly applySensitiveWithoutApproval?: boolean;
}

export interface BulkRow {
  readonly personId: string;
  readonly name: string;
  /** `held`: every value it would change waits for HR's approval (PEO-077). */
  readonly outcome: 'changed' | 'unchanged' | 'refused' | 'held';
  /** Fields sent to HR for approval rather than written. */
  readonly held?: readonly string[];
  readonly changes: readonly {
    readonly key: string;
    readonly label: string;
    /** False: kept without dates, so it changes on the day. */
    readonly dated: boolean;
    readonly before: AttributeValue;
    readonly after: AttributeValue;
  }[];
  readonly refusal: { readonly code: string; readonly message: string } | null;
  readonly findings: readonly IdentifierFinding[];
}

export type BulkOutcome =
  | { readonly ok: true; readonly committed: boolean; readonly rows: readonly BulkRow[] }
  | { readonly ok: false; readonly message: string };

/** A page of a bulk hire: each person not started yet, from their start date. */
export type BulkHirePage = readonly { readonly personId: string; readonly hireDate: string }[];

export interface BulkEditProps {
  readonly load: Loadable<BulkEditState>;
  /** What a page would change and refuse; People keeps nothing. */
  readonly onPreview: (page: BulkEditPage) => Promise<BulkOutcome>;
  /** A page, written: one ordinary write per person. */
  readonly onCommit: (page: BulkEditPage) => Promise<BulkOutcome>;
  /** Who a page of a bulk hire would hire and skip, and why; People keeps nothing. */
  readonly onPreviewHire?: (hires: BulkHirePage) => Promise<BulkOutcome>;
  /** A page, hired: each person on their own. Absent, the screen offers no hire. */
  readonly onCommitHire?: (hires: BulkHirePage) => Promise<BulkOutcome>;
  /** Finds people for a person field. */
  readonly searchPeople?: SearchPeople;
  readonly onBack?: () => void;
}

/**
 * Bulk edit (PRD §8.4, PEO-071): the same values for the people chosen in
 * the directory, from one date.
 *
 * Nothing is written before a preview has shown, per person, what would
 * change from what to what, and what would be refused and why — People
 * computes the preview by making the writes and throwing them away, so it is
 * the commit's answer, not a guess. Changing a value or the date sets the
 * preview aside: what is applied is always what was last shown.
 */
export function BulkEdit({ load, searchPeople, ...props }: BulkEditProps): JSX.Element {
  return (
    <PeopleSearch.Provider value={searchPeople ?? null}>
      <Loaded load={load} what="the people to edit">
        {(state) => {
          const { onPreviewHire, onCommitHire, ...edit } = props;
          if (onPreviewHire === undefined || onCommitHire === undefined || state.people.length === 0) {
            return <Editor state={state} {...edit} />;
          }
          return (
            <Tabs defaultValue="edit">
              <TabsList aria-label="What to do">
                <TabsTrigger value="edit">Set values</TabsTrigger>
                <TabsTrigger value="hire">Hire</TabsTrigger>
              </TabsList>
              <TabsContent value="edit">
                <Editor state={state} {...edit} />
              </TabsContent>
              <TabsContent value="hire">
                <Hire
                  state={state}
                  onPreview={onPreviewHire}
                  onCommit={onCommitHire}
                  {...(props.onBack === undefined ? {} : { onBack: props.onBack })}
                />
              </TabsContent>
            </Tabs>
          );
        }}
      </Loaded>
    </PeopleSearch.Provider>
  );
}

const TONE = {
  changed: 'accent',
  unchanged: 'neutral',
  refused: 'danger',
  held: 'warning',
} as const;
const WORD = {
  changed: 'Changes',
  unchanged: 'Already set',
  refused: 'Refused',
  held: 'Pending approval',
} as const;

/**
 * Every page in turn, `limit` people a request; stops at the first failure
 * and says how far it got, since what went before it was done.
 */
async function pages(
  ids: readonly string[],
  limit: number,
  act: (ids: readonly string[]) => Promise<BulkOutcome>,
): Promise<{ rows: BulkRow[]; committed: boolean; problem: string | null }> {
  const rows: BulkRow[] = [];
  let committed = false;
  for (let at = 0; at < ids.length; at += limit) {
    const answer = await act(ids.slice(at, at + limit));
    if (!answer.ok) {
      return {
        rows,
        committed,
        problem:
          rows.length === 0
            ? answer.message
            : `${answer.message}. Stopped after ${String(rows.length)} of ${String(ids.length)} people; the rest were not done.`,
      };
    }
    committed = answer.committed;
    rows.push(...answer.rows);
  }
  return { rows, committed, problem: null };
}

function Editor({
  state,
  onPreview,
  onCommit,
  onBack,
}: Omit<BulkEditProps, 'load' | 'searchPeople' | 'onPreviewHire' | 'onCommitHire'> & {
  readonly state: BulkEditState;
}): JSX.Element {
  const fields = state.sections.flatMap((s) => s.fields);
  const [chosen, setChosen] = useState<readonly string[]>(fields[0] ? [fields[0].key] : []);
  const [values, setValues] = useState<Readonly<Record<string, AttributeValue>>>({});
  const [effectiveFrom, setEffectiveFrom] = useState(state.today);
  const [withoutApproval, setWithoutApproval] = useState(false);
  const sensitive = fields.filter((f) => f.sensitive === true && chosen.includes(f.key));
  const [shown, setShown] = useState<{ committed: boolean; rows: readonly BulkRow[] } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const reset = (): void => {
    setShown(null);
    setProblem(null);
  };
  const page = (): Omit<BulkEditPage, 'personIds'> => ({
    values: Object.fromEntries(chosen.map((k) => [k, values[k] ?? null])),
    effectiveFrom,
    ...(withoutApproval && sensitive.length > 0 ? { applySensitiveWithoutApproval: true } : {}),
  });

  /** Every page in turn, a page of `limit` people a request; stops at the first failure. */
  const run = async (act: BulkEditProps['onPreview']): Promise<void> => {
    setBusy(true);
    setProblem(null);
    const done = await pages(
      state.people.map((p) => p.id),
      state.limit,
      (ids) => act({ ...page(), personIds: ids }),
    );
    setProblem(done.problem);
    setShown(done.rows.length === 0 ? null : { committed: done.committed, rows: done.rows });
    setBusy(false);
  };

  const count = (outcome: BulkRow['outcome']) =>
    shown?.rows.filter((r) => r.outcome === outcome).length ?? 0;
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const open = fields.filter((f) => !chosen.includes(f.key));

  if (state.people.length === 0) {
    return (
      <EmptyState
        title="Nobody is chosen"
        description="Choose people in the directory, then edit them together."
        action={onBack === undefined ? undefined : <Button onClick={onBack}>Directory</Button>}
      />
    );
  }

  return (
    <Stack gap={6}>
      <PageHeader
        title={`Edit ${String(state.people.length)} ${state.people.length === 1 ? 'person' : 'people'}`}
        description={state.people.map((p) => p.name).join(', ')}
        actions={onBack === undefined ? undefined : <Button onClick={onBack}>Directory</Button>}
      />

      <Card className="flex flex-col gap-4 p-4">
        {chosen.map((key) => {
          const field = byKey.get(key);
          if (field === undefined) return null;
          return (
            <div key={key} className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <Field className="sm:w-56">
                <FieldLabel>Field</FieldLabel>
                <Select
                  value={key}
                  onValueChange={(next) => {
                    reset();
                    setChosen((c) => c.map((k) => (k === key ? next : k)));
                  }}
                >
                  <FieldControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FieldControl>
                  <SelectContent>
                    {[field, ...open].map((f) => (
                      <SelectItem key={f.key} value={f.key}>
                        {f.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <div className="min-w-0 flex-1">
                <AttributeInput
                  field={{ ...field, required: false }}
                  value={values[key] ?? null}
                  onChange={(next) => {
                    reset();
                    setValues((v) => ({ ...v, [key]: next }));
                  }}
                />
              </div>
              {chosen.length === 1 ? null : (
                <Button
                  variant="ghost"
                  aria-label={`Remove ${field.label}`}
                  onClick={() => {
                    reset();
                    setChosen((c) => c.filter((k) => k !== key));
                  }}
                >
                  Remove
                </Button>
              )}
            </div>
          );
        })}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <DatePicker
            label="Takes effect from"
            value={effectiveFrom}
            onChange={(next) => {
              reset();
              setEffectiveFrom(next ?? state.today);
            }}
          />
          {open.length === 0 ? null : (
            <Button
              onClick={() => {
                reset();
                setChosen((c) => [...c, open[0]?.key ?? '']);
              }}
            >
              Add a field
            </Button>
          )}
        </div>
        <p className="text-sm text-fg-muted">
          Empty clears the field. A field kept without dates changes on the day, whatever the date
          says.
        </p>
        {sensitive.length === 0 ? null : (
          <Field orientation="horizontal" className="justify-start">
            <FieldControl>
              <Checkbox
                checked={withoutApproval}
                onCheckedChange={(on) => {
                  reset();
                  setWithoutApproval(on === true);
                }}
              />
            </FieldControl>
            <FieldLabel>Apply sensitive values without approval</FieldLabel>
            <FieldDescription>
              {sensitive.map((f) => f.label).join(', ')} otherwise wait for a second HR member to
              approve them. Each change records that you applied it without approval.
            </FieldDescription>
          </Field>
        )}
      </Card>

      {problem === null ? null : (
        <Alert tone="danger" title="That did not go through">
          {problem}
        </Alert>
      )}

      {shown === null ? (
        <div>
          <Button
            variant="primary"
            disabled={chosen.length === 0}
            loading={busy}
            loadingLabel="Working out what would change"
            onClick={() => {
              void run(onPreview);
            }}
          >
            Preview changes
          </Button>
        </div>
      ) : (
        <Stack gap={4}>
          {shown.committed ? (
            <Alert tone={count('refused') === 0 ? 'success' : 'warning'}>
              {`Saved for ${String(count('changed'))} ${count('changed') === 1 ? 'person' : 'people'}.`}
              {count('refused') === 0
                ? ''
                : ` ${String(count('refused'))} refused, as each says below; nothing was written for them.`}
            </Alert>
          ) : (
            <Alert tone="info" title="Nothing is saved yet">
              This is what applying would do, person by person. Each person is saved on their own:
              one refused does not stop the others.
            </Alert>
          )}
          <AutoGrid minItemWidth="10rem" gap={3}>
            <Stat label={shown.committed ? 'Changed' : 'Will change'} value={count('changed')} />
            <Stat label="Already set" value={count('unchanged')} />
            <Stat label="Refused" value={count('refused')} />
            {count('held') === 0 ? null : (
              <Stat label="Pending approval" value={count('held')} />
            )}
          </AutoGrid>
          <Results rows={shown.rows} byKey={byKey} />
          {shown.committed ? null : (
            <div>
              <Button
                variant="primary"
                disabled={count('changed') + count('held') === 0}
                loading={busy}
                loadingLabel="Saving"
                onClick={() => {
                  void run(onCommit);
                }}
              >
                {`Apply to ${String(count('changed') + count('held'))} ${count('changed') + count('held') === 1 ? 'person' : 'people'}`}
              </Button>
            </div>
          )}
        </Stack>
      )}
    </Stack>
  );
}

/**
 * Bulk hire: the people chosen who were added without a start date, hired
 * from one — the same for all, or one each. The preview is People hiring
 * them and throwing it away, so who it skips and why (already employed,
 * nowhere to work, no work email) is the commit's own answer. Each person is
 * hired on their own: one skipped leaves the others hired.
 */
function Hire({
  state,
  onPreview,
  onCommit,
  onBack,
}: {
  readonly state: BulkEditState;
  readonly onPreview: (hires: BulkHirePage) => Promise<BulkOutcome>;
  readonly onCommit: (hires: BulkHirePage) => Promise<BulkOutcome>;
  readonly onBack?: () => void;
}): JSX.Element {
  const [day, setDay] = useState(state.today);
  const [each, setEach] = useState(false);
  const [dates, setDates] = useState<Readonly<Record<string, string>>>({});
  const [shown, setShown] = useState<{ committed: boolean; rows: readonly BulkRow[] } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const reset = (): void => {
    setShown(null);
    setProblem(null);
  };
  const dateOf = (id: string): string => (each ? (dates[id] ?? day) : day);

  const run = async (act: (hires: BulkHirePage) => Promise<BulkOutcome>): Promise<void> => {
    setBusy(true);
    setProblem(null);
    const done = await pages(
      state.people.map((p) => p.id),
      state.limit,
      (ids) => act(ids.map((personId) => ({ personId, hireDate: dateOf(personId) }))),
    );
    setProblem(done.problem);
    setShown(done.rows.length === 0 ? null : { committed: done.committed, rows: done.rows });
    setBusy(false);
  };
  const count = (outcome: BulkRow['outcome']) =>
    shown?.rows.filter((r) => r.outcome === outcome).length ?? 0;
  const hired = count('changed');
  const skipped = count('refused');

  return (
    <Stack gap={6}>
      <PageHeader
        title={`Hire ${String(state.people.length)} ${state.people.length === 1 ? 'person' : 'people'}`}
        description="People added without a start date become employees from it: active once it has begun on their calendar, starting soon until then."
        actions={onBack === undefined ? undefined : <Button onClick={onBack}>Directory</Button>}
      />
      <Card className="flex flex-col gap-4 p-4">
        <DatePicker
          label="Start date"
          value={day}
          onChange={(next) => {
            reset();
            setDay(next ?? state.today);
          }}
        />
        <Field orientation="horizontal" className="justify-start">
          <FieldControl>
            <Checkbox
              checked={each}
              onCheckedChange={(on) => {
                reset();
                setEach(on === true);
              }}
            />
          </FieldControl>
          <FieldLabel>Set a start date per person</FieldLabel>
        </Field>
        {each ? (
          <ul className="flex flex-col gap-3" aria-label="Start date per person">
            {state.people.map((p) => (
              <li key={p.id}>
                <DatePicker
                  label={p.name}
                  value={dateOf(p.id)}
                  onChange={(next) => {
                    reset();
                    setDates((d) => ({ ...d, [p.id]: next ?? day }));
                  }}
                />
              </li>
            ))}
          </ul>
        ) : null}
        <p className="text-sm text-fg-muted">
          Each date is a day on the person’s own calendar, past or future.
        </p>
      </Card>

      {problem === null ? null : (
        <Alert tone="danger" title="That did not go through">
          {problem}
        </Alert>
      )}

      {shown === null ? (
        <div>
          <Button
            variant="primary"
            loading={busy}
            loadingLabel="Working out who would be hired"
            onClick={() => {
              void run(onPreview);
            }}
          >
            Preview hire
          </Button>
        </div>
      ) : (
        <Stack gap={4}>
          {shown.committed ? (
            <Alert tone={skipped === 0 ? 'success' : 'warning'}>
              {`Hired ${String(hired)} ${hired === 1 ? 'person' : 'people'}.`}
              {skipped === 0
                ? ''
                : ` ${String(skipped)} skipped, as each says below; nothing was done for them.`}
            </Alert>
          ) : (
            <Alert tone="info" title="Nobody is hired yet">
              This is what hiring would do, person by person. Each person is hired on their own:
              one skipped does not stop the others.
            </Alert>
          )}
          <AutoGrid minItemWidth="10rem" gap={3}>
            <Stat label={shown.committed ? 'Hired' : 'Will be hired'} value={hired} />
            <Stat label="Skipped" value={skipped} />
          </AutoGrid>
          <Results rows={shown.rows} byKey={new Map()} words={HIRE_WORD} />
          {shown.committed ? null : (
            <div>
              <Button
                variant="primary"
                disabled={hired === 0}
                loading={busy}
                loadingLabel="Hiring"
                onClick={() => {
                  void run(onCommit);
                }}
              >
                {`Hire ${String(hired)} ${hired === 1 ? 'person' : 'people'}`}
              </Button>
            </div>
          )}
        </Stack>
      )}
    </Stack>
  );
}

const HIRE_WORD: Record<BulkRow['outcome'], string> = {
  changed: 'Hired',
  unchanged: 'Already set',
  refused: 'Skipped',
  held: 'Pending approval',
};

function Results({
  rows,
  byKey,
  words = WORD,
}: {
  readonly rows: readonly BulkRow[];
  readonly byKey: ReadonlyMap<string, RecordField>;
  readonly words?: Readonly<Record<BulkRow['outcome'], string>>;
}): JSX.Element {
  const wide = useBreakpoint('md');
  const what = (r: BulkRow): JSX.Element | null => {
    if (r.refusal !== null) return <span>{r.refusal.message}</span>;
    const held = r.held ?? [];
    if (r.changes.length === 0 && held.length === 0) return null;
    return (
      <ul className="flex flex-col gap-1">
        {held.length === 0 ? null : (
          <li>
            {held.join(', ')}: waits for HR&apos;s approval; the record keeps what it had until then.
          </li>
        )}
        {r.changes.map((c) => {
          const field = byKey.get(c.key) ?? FALLBACK(c);
          return (
            <li key={c.key}>
              {c.label}: <DisplayValue field={field} value={c.before} /> →{' '}
              <DisplayValue field={field} value={c.after} />
              {c.dated ? null : <span className="text-fg-muted"> (today, not dated)</span>}
            </li>
          );
        })}
        {r.findings.map((f) => (
          <li key={`${f.key}-${f.code}`} className="text-warning-fg">
            {f.label}: {f.message} HR will review it.
          </li>
        ))}
      </ul>
    );
  };
  const badge = (r: BulkRow) => (
    <Badge tone={TONE[r.outcome]} size="sm">
      {words[r.outcome]}
    </Badge>
  );
  const columns: DataColumn<BulkRow>[] = [
    { id: 'person', header: 'Person', cell: (r) => r.name },
    { id: 'outcome', header: 'Outcome', cell: badge },
    { id: 'what', header: 'What', cell: what },
  ];
  return wide ? (
    <DataTable label="Per person" rows={rows} columns={columns} rowId={(r) => r.personId} />
  ) : (
    <ul className="flex flex-col gap-2" aria-label="Per person">
      {rows.map((r) => (
        <li key={r.personId}>
          <Card className="flex flex-col gap-2 p-3">
            <span className="flex items-center justify-between gap-2">
              <span className="truncate font-medium">{r.name}</span>
              {badge(r)}
            </span>
            {what(r)}
          </Card>
        </li>
      ))}
    </ul>
  );
}

/** A change to a field no longer offered: shown as text. */
const FALLBACK = (c: { key: string; label: string }): RecordField => ({
  key: c.key,
  label: c.label,
  description: null,
  dataType: 'text',
  options: [],
  required: false,
  readOnly: true,
});
