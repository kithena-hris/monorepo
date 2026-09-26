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
import { useEffect, useRef, useState, type JSX } from 'react';

import { Loaded, type IdentifierFinding, type Loadable } from '../load';
import { PlacementPickers, type PlacementState } from '../profile/employment';
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
  /** Where a bulk hire may place somebody placed nowhere; absent or null, nowhere to choose. */
  readonly placement?: Pick<PlacementState, 'entities' | 'locations'> | null;
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

/**
 * A page of a bulk hire: each person not started yet, from their start date,
 * and where to place them should they be placed nowhere that day.
 */
export type BulkHirePage = readonly {
  readonly personId: string;
  readonly hireDate: string;
  readonly legalEntityId?: string;
  readonly locationId?: string;
}[];

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
 * from one — the same for all, changed person by person in the preview. The
 * preview is People hiring them and throwing it away, so who it skips and
 * why (already employed, nowhere to work, no work email) is the commit's own
 * answer. Each person is hired on their own: one skipped leaves the others
 * hired.
 *
 * Somebody placed nowhere on their start date is placed where HR says: one
 * legal entity and location for all of them, changed per person in the
 * preview; somebody placed keeps theirs. Once shown, the preview follows
 * every change — recomputed after a pause, an older answer never drawn over
 * a newer one — and the hire sends exactly what the preview on screen was
 * computed from, and is not offered while it is being recomputed.
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
  const [place, setPlace] = useState<Placed>(NOWHERE);
  const [dates, setDates] = useState<Readonly<Record<string, string>>>({});
  const [places, setPlaces] = useState<Readonly<Record<string, Placed>>>({});
  const [shown, setShown] = useState<{
    committed: boolean;
    rows: readonly BulkRow[];
    /** What this answer was computed from: what a hire sends. */
    sent: BulkHirePage;
  } | null>(null);
  const [busy, setBusy] = useState<'preview' | 'commit' | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // Every run is numbered; only the latest one's answer is drawn.
  const latest = useRef(0);

  const placeOf = (id: string): Placed => places[id] ?? place;
  const hires: BulkHirePage = state.people.map(({ id }) => {
    const { entity, location } = placeOf(id);
    return {
      personId: id,
      hireDate: dates[id] ?? day,
      ...(entity === '' ? {} : { legalEntityId: entity }),
      ...(location === '' ? {} : { locationId: location }),
    };
  });
  const asked = JSON.stringify(hires);

  const run = async (kind: 'preview' | 'commit', sent: BulkHirePage): Promise<void> => {
    const act = kind === 'preview' ? onPreview : onCommit;
    latest.current += 1;
    const mine = latest.current;
    setBusy(kind);
    setProblem(null);
    const byId = new Map(sent.map((h) => [h.personId, h]));
    const done = await pages(
      sent.map((h) => h.personId),
      state.limit,
      (ids) => act(ids.flatMap((id) => byId.get(id) ?? [])),
    );
    if (mine !== latest.current) return;
    setProblem(done.problem);
    setShown(done.rows.length === 0 ? null : { committed: done.committed, rows: done.rows, sent });
    setBusy(null);
  };

  // A preview on screen follows every change, after a pause for typing.
  const previewed = shown !== null && !shown.committed;
  const stale = previewed && JSON.stringify(shown.sent) !== asked;
  // Not while hiring: the hire's answer is the one to draw.
  const waiting = stale && busy !== 'commit';
  useEffect(() => {
    if (!waiting) return undefined;
    // This render's inputs: the effect runs again whenever `asked` changes.
    const timer = setTimeout(() => {
      void run('preview', hires);
    }, RECOMPUTE_AFTER_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [waiting, asked]);

  const count = (outcome: BulkRow['outcome']) =>
    shown?.rows.filter((r) => r.outcome === outcome).length ?? 0;
  const hired = count('changed');
  const skipped = count('refused');
  const recomputing = stale || busy === 'preview';

  const placing = state.placement ?? null;
  const edit = (r: BulkRow): JSX.Element => {
    const who = r.name;
    const needsPlace =
      placing !== null &&
      (r.refusal?.code === 'PLACEMENT_REQUIRED' || r.changes.some((c) => c.key === 'legal_entity_id'));
    const mine = placeOf(r.personId);
    const setMine = (next: (p: Placed) => Placed): void => {
      setPlaces((p) => ({ ...p, [r.personId]: next(p[r.personId] ?? place) }));
    };
    return (
      <Stack gap={2}>
        <DatePicker
          label={`Start date for ${who}`}
          size="sm"
          value={dates[r.personId] ?? day}
          onChange={(next) => {
            setDates((d) => ({ ...d, [r.personId]: next ?? day }));
          }}
        />
        {needsPlace ? (
          <PlacementPickers
            placement={placing}
            who={who}
            entity={mine.entity}
            location={mine.location}
            onEntity={(entity) => {
              setMine((p) => ({ ...p, entity }));
            }}
            onLocation={(location) => {
              setMine((p) => ({ ...p, location }));
            }}
          />
        ) : null}
      </Stack>
    );
  };

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
            setDay(next ?? state.today);
          }}
        />
        <p className="text-sm text-fg-muted">
          Each date is a day on the person’s own calendar, past or future. Change it for one person
          in the preview.
        </p>
        {placing === null ? null : (
          <PlacementPickers
            placement={placing}
            entity={place.entity}
            location={place.location}
            onEntity={(entity) => {
              setPlace((p) => ({ ...p, entity }));
            }}
            onLocation={(location) => {
              setPlace((p) => ({ ...p, location }));
            }}
            locationHint="For anybody placed nowhere on their start date, placed from it; change it for one person in the preview. Somebody already placed keeps their placement."
          />
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
            loading={busy === 'preview'}
            loadingLabel="Working out who would be hired"
            onClick={() => {
              void run('preview', hires);
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
          <Results
            rows={shown.rows}
            byKey={new Map()}
            words={HIRE_WORD}
            {...(shown.committed ? {} : { edit, editHeader: 'Start date and placement' })}
          />
          {shown.committed ? null : (
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="primary"
                disabled={hired === 0 || recomputing}
                loading={busy === 'commit'}
                loadingLabel="Hiring"
                onClick={() => {
                  void run('commit', shown.sent);
                }}
              >
                {`Hire ${String(hired)} ${hired === 1 ? 'person' : 'people'}`}
              </Button>
              <p role="status" className="text-sm text-fg-muted">
                {recomputing ? 'Updating the preview…' : ''}
              </p>
            </div>
          )}
        </Stack>
      )}
    </Stack>
  );
}

/** A legal entity and location, `''` for none chosen. */
interface Placed {
  readonly entity: string;
  readonly location: string;
}
const NOWHERE: Placed = { entity: '', location: '' };

/** How long a preview waits after a change before it is recomputed. */
const RECOMPUTE_AFTER_MS = 400;

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
  edit,
  editHeader = '',
}: {
  readonly rows: readonly BulkRow[];
  readonly byKey: ReadonlyMap<string, RecordField>;
  readonly words?: Readonly<Record<BulkRow['outcome'], string>>;
  /** What may still be changed for one person, beside what the preview says. */
  readonly edit?: (row: BulkRow) => JSX.Element;
  readonly editHeader?: string;
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
    ...(edit === undefined ? [] : [{ id: 'edit', header: editHeader, cell: edit }]),
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
            {edit?.(r)}
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
