import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  InlineCell,
  List,
  ListItem,
  PageHeader,
  Progress,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sparkline,
  Stack,
  Stat,
  icons,
  type ChartPoint,
  type DataColumn,
} from '@reach/ui';
import { useEffect, useState, type JSX } from 'react';

import { DATA_HEALTH } from '../data-health';
import { Loaded, type IdentifierFinding, type Loadable } from '../load';
import { PeopleSearch, PersonPicker, type SearchPeople } from '../record/attribute-input';

/** A field somebody is missing: HR's to fill in, or the person's own. */
export interface GapField {
  readonly key: string;
  readonly label: string;
  /** The choices, for a list; empty for free text and for a person. */
  readonly options: readonly { readonly value: string; readonly label: string }[];
  /** A person reference: picked by searching people, not from `options`. */
  readonly person: boolean;
  /** A change to it waits for HR's approval (PEO-077). */
  readonly sensitive?: boolean;
}

export interface GapRow {
  readonly personId: string;
  readonly name: string;
  readonly department: string | null;
  readonly manager: string | null;
  /** Which of the fields above this person is missing. */
  readonly missing: readonly string[];
  /** Who fills these in: HR, in the grid, or the person, when reminded. */
  readonly owner: 'hr' | 'employee';
  /** The person's last reminder, weekly or asked for; null for HR's rows and for never. */
  readonly remindedAt: string | null;
}

export interface CompletenessState {
  /** "Since version 4 was published on 22 Sep". */
  readonly since: string;
  /** Employee-owned gaps: reminders, not this grid. */
  readonly waiting: {
    readonly people: number;
    /** The last weekly reminder anybody waiting was sent (ISO 8601); null for none. */
    readonly lastReminded: string | null;
    /** How many "Remind" would send to now; null where it cannot run. */
    readonly due: number | null;
  };
  readonly completedThisWeek: number;
  /** HR's missing values over everybody, not only this page. */
  readonly toFill: number;
  /** People missing bank, tax or ID details; null where People cannot say. */
  readonly blocking: number | null;
  readonly fields: readonly GapField[];
  readonly rows: readonly GapRow[];
  /** From analytics, where the viewer may read it: complete records, overall. */
  readonly complete?: {
    readonly percent: number;
    readonly incomplete: number;
    /** Points since the snapshot a month ago; null when there is none. */
    readonly change?: number | null;
    /** Percent complete by month, snapshot months only. */
    readonly trend?: readonly ChartPoint[];
  } | null;
}

/** One person's answers, however many fields they cover: one write, one event. */
export interface GridSave {
  readonly personId: string;
  readonly values: Readonly<Record<string, string>>;
}

/** A cell our checks doubt (PEO-125): which person, and what was found. Never the value. */
export type GridFinding = IdentifierFinding & { readonly personId: string };

/** What "Remind N people" did: sent, lost in sending, and not due yet. */
export type RemindOutcome =
  | {
      readonly ok: true;
      readonly sent: number;
      readonly failed: number;
      readonly skipped: number;
    }
  | { readonly ok: false; readonly message: string };

/** What saving cells would be warned about, or saved with. */
export type GridOutcome =
  | {
      readonly ok: true;
      readonly findings?: readonly GridFinding[];
      /** Cells sent to HR for approval rather than saved (PEO-077). */
      readonly held?: number;
    }
  | { readonly ok: false; readonly message: string };

export interface CompletenessGridProps {
  readonly load: Loadable<CompletenessState>;
  readonly onSave: (changes: readonly GridSave[]) => Promise<GridOutcome>;
  /**
   * What our checks would warn about a national identifier in these cells,
   * before they are saved (PEO-125). Absent: save straight away.
   */
  readonly onCheck?: (changes: readonly GridSave[]) => Promise<GridOutcome>;
  /** Finds people for a person field, by name, over everybody (PEO-122). */
  readonly searchPeople?: SearchPeople;
  /** Present when there are more people after this page (PEO-122). */
  readonly onNextPage?: () => void;
  /** Present when this is not the first page. */
  readonly onFirstPage?: () => void;
  /** Everybody due a reminder, now, through the weekly sweep. Absent: no button. */
  readonly onRemindAll?: () => Promise<RemindOutcome>;
  /** One person, asked for their own missing fields. Absent: no Remind on a row. */
  readonly onRemind?: (
    personId: string,
    keys: readonly string[],
  ) => Promise<{ readonly ok: true } | { readonly ok: false; readonly message: string }>;
}

/**
 * Data health's Completeness tab (V4, MV2; PRD §8.4, design screen 8).
 *
 * First who is missing what, one row a person, as a list to read. "Fill in"
 * opens the grid over exactly the missing cells, at that person's first one.
 *
 * The work is filling one field twenty-seven times, not twenty-seven fields
 * once, so the grid shows one field's column at a time and the keyboard runs
 * down it: each row has one control, so Tab is row after row. Every editable
 * cell is a real `Select` or `Input` inside `DataTable`, never a div that turns
 * into one on click. A save sends one change per person, however many fields
 * were filled for them, so each person raises one `profile_updated`.
 *
 * A person's own gaps are a row of their own, "Remind" rather than "Fill
 * in": HR cannot type somebody's bank account for them, only ask. "Remind N
 * people" runs the weekly reminder now for everybody due one; the week's cap
 * still holds, so pressing it twice sends nothing twice.
 */
export function CompletenessGrid({
  load,
  searchPeople,
  ...props
}: CompletenessGridProps): JSX.Element {
  return (
    <PeopleSearch.Provider value={searchPeople ?? null}>
      <Loaded load={load} what="the missing information">
        {(state) => <Grid state={state} {...props} />}
      </Loaded>
    </PeopleSearch.Provider>
  );
}

function Grid({
  state,
  onSave,
  onCheck,
  onNextPage,
  onFirstPage,
  onRemindAll,
  onRemind,
}: Omit<CompletenessGridProps, 'load' | 'searchPeople'> & {
  readonly state: CompletenessState;
}): JSX.Element {
  /** Filling in, from whose row: the grid, and that person's first cell focused. */
  const [filling, setFilling] = useState<{ readonly from: string } | null>(null);
  // personId → key → value, across every field the admin has worked through.
  const [edits, setEdits] = useState<Readonly<Record<string, Readonly<Record<string, string>>>>>(
    {},
  );
  const [saving, setSaving] = useState(false);
  const [outcome, setOutcome] = useState<GridOutcome | null>(null);
  /** Cells our checks doubt, and the edits they were found in: the next press saves anyway. */
  const [warned, setWarned] = useState<{
    readonly edits: string;
    readonly findings: readonly GridFinding[];
  } | null>(null);
  /** After a save: how many values went to HR's review. */
  const [reviewed, setReviewed] = useState(0);
  const [reminding, setReminding] = useState(false);
  const [reminded, setReminded] = useState<RemindOutcome | null>(null);
  /** Rows reminded from here, by row id: null once sent, or why it was not. */
  const [asked, setAsked] = useState<Readonly<Record<string, string | null>>>({});

  const pending = Object.values(edits).reduce((n, v) => n + Object.keys(v).length, 0);
  // The grid is HR's rows only: the person's own are theirs to fill.
  const rows = state.rows.filter((r) => r.owner === 'hr');
  // Only the fields somebody on this page is missing: a column of nothing is noise.
  const fields = state.fields.filter((f) => rows.some((r) => r.missing.includes(f.key)));
  const labelOf = new Map(state.fields.map((f) => [f.key, f.label]));
  const rowId = (r: GapRow): string => `${r.personId}-${r.owner}`;

  // "Fill in" lands on that person's first missing cell, in the grid's column order.
  useEffect(() => {
    if (filling === null) return;
    const missing = rows.find((r) => r.personId === filling.from)?.missing ?? [];
    const first = fields.find((f) => missing.includes(f.key));
    if (first !== undefined) document.getElementById(`cell-${filling.from}-${first.key}`)?.focus();
    // Once per "Fill in", not on every keystroke in the grid.
  }, [filling]);

  const set = (personId: string, key: string, value: string): void => {
    setOutcome(null);
    setReviewed(0);
    setEdits((e) => ({ ...e, [personId]: { ...e[personId], [key]: value } }));
  };
  const stillWarned = warned !== null && warned.edits === JSON.stringify(edits);
  const shown = stillWarned ? warned.findings : [];
  const warningFor = (personId: string, key: string): string | undefined => {
    const messages = shown
      .filter((f) => f.personId === personId && f.key === key)
      .map((f) => f.message);
    return messages.length === 0
      ? undefined
      : `Our checks suggest this may be wrong: ${messages.join(' ')}`;
  };

  const save = async (): Promise<void> => {
    const changes = Object.entries(edits)
      .map(([personId, values]) => ({
        personId,
        values: Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim() !== '')),
      }))
      .filter((c) => Object.keys(c.values).length > 0);
    setSaving(true);
    if (onCheck !== undefined && !stillWarned) {
      const checked = await onCheck(changes);
      if (!checked.ok) {
        setSaving(false);
        setOutcome(checked);
        return;
      }
      // A value HR already accepted is final: nothing to warn about (PEO-125).
      const found = (checked.findings ?? []).filter((f) => f.review !== 'accepted');
      if (found.length > 0) {
        setSaving(false);
        setWarned({ edits: JSON.stringify(edits), findings: found });
        return;
      }
    }
    const result = await onSave(changes);
    setSaving(false);
    setOutcome(result);
    if (result.ok) {
      setEdits({});
      setWarned(null);
      setReviewed((result.findings ?? []).filter((f) => f.review === 'pending').length);
    }
  };

  /** ↵ in a text cell moves to the same field on the next row, as a sheet does. */
  const down = (personId: string, key: string): void => {
    const at = rows.findIndex((r) => r.personId === personId);
    const next = rows.slice(at + 1).find((r) => r.missing.includes(key));
    if (next === undefined) return;
    document.getElementById(`cell-${next.personId}-${key}`)?.focus();
  };
  const control = (r: GapRow, field: GapField): JSX.Element | null => {
    if (!r.missing.includes(field.key)) {
      return (
        <span className="text-fg-subtle" aria-label="Already filled in">
          —
        </span>
      );
    }
    const value = edits[r.personId]?.[field.key] ?? '';
    const name = `${field.label} for ${r.name}`;
    if (field.person) {
      return (
        <PersonPicker
          label={name}
          size="sm"
          value={value}
          known={[]}
          onChange={(next) => {
            set(r.personId, field.key, next);
          }}
        />
      );
    }
    if (field.options.length > 0) {
      return (
        <Select
          value={value}
          onValueChange={(next) => {
            set(r.personId, field.key, next);
          }}
        >
          <SelectTrigger
            id={`cell-${r.personId}-${field.key}`}
            aria-label={name}
            size="sm"
            className="min-w-32"
          >
            <SelectValue placeholder="Missing" />
          </SelectTrigger>
          <SelectContent>
            {field.options.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }
    const warning = warningFor(r.personId, field.key);
    return (
      <InlineCell
        id={`cell-${r.personId}-${field.key}`}
        aria-label={name}
        value={value}
        {...(warning !== undefined
          ? { status: 'invalid' as const }
          : value === ''
            ? { status: 'missing' as const }
            : {})}
        {...(warning === undefined ? {} : { message: warning })}
        onChange={(e) => {
          set(r.personId, field.key, e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            down(r.personId, field.key);
          }
        }}
        containerClassName="min-w-32"
      />
    );
  };

  const person: DataColumn<GapRow> = {
    id: 'person',
    header: 'Person',
    width: '15rem',
    sticky: true,
    cell: (r) => (
      <span className="flex items-center gap-2.5">
        <Avatar size="md" name={r.name} />
        <span className="min-w-0">
          <span className="block truncate font-semibold">{r.name}</span>
          <span className="block truncate text-xs text-fg-muted">
            {[r.department, r.manager].filter((x) => x !== null).join(' · ')}
          </span>
        </span>
      </span>
    ),
  };
  const columns: DataColumn<GapRow>[] = [
    person,
    ...fields.map((field): DataColumn<GapRow> => ({
      id: field.key,
      header:
        field.sensitive === true ? (
          <span className="inline-flex items-center gap-2">
            {field.label}
            <Badge tone="sensitive" size="sm">
              Sensitive
            </Badge>
          </span>
        ) : (
          field.label
        ),
      cell: (r) => control(r, field),
    })),
  ];

  const missingOf = (r: GapRow): string[] => r.missing.map((key) => labelOf.get(key) ?? key);
  const fillIn = (r: GapRow): JSX.Element => (
    <Button
      size="xs"
      variant="primary"
      aria-label={`Fill in ${r.name}`}
      onClick={() => {
        setFilling({ from: r.personId });
      }}
    >
      Fill in
    </Button>
  );
  const remindAll = async (): Promise<void> => {
    if (onRemindAll === undefined) return;
    setReminding(true);
    setReminded(await onRemindAll());
    setReminding(false);
  };
  const remind = async (r: GapRow): Promise<void> => {
    if (onRemind === undefined) return;
    setAsked((a) => ({ ...a, [rowId(r)]: null }));
    const result = await onRemind(r.personId, r.missing);
    if (!result.ok) setAsked((a) => ({ ...a, [rowId(r)]: result.message }));
  };
  // Asked within the day, here or by the weekly email: another press would be a second email.
  const recently = (r: GapRow): boolean =>
    asked[rowId(r)] === null ||
    (r.remindedAt !== null && Date.now() - Date.parse(r.remindedAt) < DAY_MS);
  const action = (r: GapRow): JSX.Element | null =>
    r.owner === 'hr' ? (
      fillIn(r)
    ) : onRemind === undefined ? null : recently(r) ? (
      <Button size="xs" disabled aria-label={`Reminded ${r.name}`}>
        Reminded
      </Button>
    ) : (
      <Button
        size="xs"
        aria-label={`Remind ${r.name}`}
        onClick={() => {
          void remind(r);
        }}
      >
        Remind
      </Button>
    );
  const list: DataColumn<GapRow>[] = [
    { ...person, sticky: false },
    {
      id: 'missing',
      header: 'Missing',
      cell: (r) => (
        <span className="flex flex-wrap gap-1.5">
          {missingOf(r).map((label) => (
            <Badge key={label} size="sm">
              {label}
            </Badge>
          ))}
        </span>
      ),
    },
    {
      id: 'who',
      header: 'Who fills it in',
      width: '9rem',
      cell: (r) =>
        r.owner === 'hr' ? (
          <Badge size="sm" tone="accent">
            HR
          </Badge>
        ) : (
          <Badge size="sm">Employee</Badge>
        ),
    },
    { id: 'act', header: <span className="sr-only">Action</span>, width: '7rem', cell: action },
  ];

  const waiting = `${state.waiting.people.toLocaleString('en-GB')} waiting on employees`;
  const toFill = `${state.toFill.toLocaleString('en-GB')} for HR`;
  const due = state.waiting.due ?? 0;
  const change = state.complete?.change ?? null;
  const trend = state.complete?.trend ?? [];
  const failed = Object.values(asked).find((message) => message !== null);

  return (
    <Stack gap={5}>
      <PageHeader
        title={DATA_HEALTH.title}
        description={DATA_HEALTH.description}
        actions={
          filling === null ? (
            onRemindAll === undefined || due === 0 ? undefined : (
              // A desk's (V4): on a phone each row carries its own Remind (MV2).
              <Button
                className="touch:hidden"
                startIcon={<icons.notifications aria-hidden />}
                loading={reminding}
                loadingLabel="Sending"
                onClick={() => {
                  void remindAll();
                }}
              >
                Remind {due.toLocaleString('en-GB')} {due === 1 ? 'person' : 'people'}
              </Button>
            )
          ) : (
            <>
              <Button
                onClick={() => {
                  setFilling(null);
                }}
              >
                Back to the list
              </Button>
              <Button
                variant="primary"
                disabled={pending === 0}
                loading={saving}
                loadingLabel="Saving"
                onClick={() => {
                  void save();
                }}
              >
                {shown.length > 0
                  ? 'Save anyway'
                  : pending === 0
                    ? 'Save'
                    : `Save ${String(pending)} ${pending === 1 ? 'change' : 'changes'}`}
              </Button>
            </>
          )
        }
      />
      {/* At a desk, the four figures; a phone gets the one that matters, as a bar. */}
      <div className="grid grid-cols-2 gap-3.5 @5xl/page:grid-cols-4 touch:hidden">
        {state.complete == null ? null : (
          <Stat
            label="Complete"
            value={state.complete.percent}
            unit="%"
            {...(change === null
              ? {
                  description: `${state.complete.incomplete.toLocaleString('en-GB')} records incomplete`,
                }
              : {
                  delta: `${change > 0 ? '+' : change < 0 ? '−' : ''}${String(Math.abs(change))} pts`,
                  deltaLabel: 'this month',
                  direction: change > 0 ? 'up' : change < 0 ? 'down' : 'flat',
                  sentiment: change > 0 ? 'positive' : change < 0 ? 'negative' : 'neutral',
                })}
            chart={
              trend.length > 1 ? (
                <Sparkline
                  data={trend}
                  label="Complete records by month"
                  {...(change === null || change === 0
                    ? {}
                    : { tone: change > 0 ? ('success' as const) : ('danger' as const) })}
                />
              ) : undefined
            }
          />
        )}
        <Stat
          label="Waiting on employees"
          value={state.waiting.people}
          description={
            state.waiting.lastReminded === null
              ? 'Reminded by email once a week'
              : `Last reminded ${shortDay(state.waiting.lastReminded)}`
          }
        />
        <Stat label="For HR to fill in" value={state.toFill} description="Fill them in below" />
        {state.blocking === null ? null : (
          <Stat label="Blocking payroll" value={state.blocking} description="Bank, tax or ID details" />
        )}
      </div>
      <Card padded className="hidden touch:block">
        {state.complete == null ? null : (
          <p className="mb-2 flex items-baseline gap-2">
            <span className="font-display text-3xl font-bold tabular-nums">
              {state.complete.percent}%
            </span>
            <span className="text-sm text-fg-muted">complete</span>
          </p>
        )}
        {state.complete == null ? null : (
          <Progress value={state.complete.percent} label="Records complete" className="mb-2" />
        )}
        <p className="text-sm text-fg-muted">
          {waiting} · {toFill}
        </p>
      </Card>

      {reminded === null ? null : reminded.ok ? (
        <Alert tone="success">{remindedText(reminded)}</Alert>
      ) : (
        <Alert tone="danger" title="Nobody was reminded">
          {reminded.message}
        </Alert>
      )}
      {failed === undefined ? null : (
        <Alert tone="danger" title="That reminder was not sent">
          {failed}
        </Alert>
      )}
      {shown.length === 0 ? null : (
        <Alert tone="warning" title="Our checks suggest some of these may be wrong">
          Check the marked cells. If they’re correct, save anyway and HR will review them.
        </Alert>
      )}
      {outcome === null ? null : outcome.ok ? (
        <Alert tone="success">
          Saved. Each person's record now carries what you filled in.
          {(outcome.held ?? 0) > 0
            ? ` ${String(outcome.held)} ${outcome.held === 1 ? 'value waits' : 'values wait'} for HR's approval and ${outcome.held === 1 ? 'is' : 'are'} not applied until then.`
            : ''}
          {reviewed > 0
            ? ` ${String(reviewed)} ${reviewed === 1 ? 'value our checks doubted went' : 'values our checks doubted went'} to HR's review.`
            : ''}
        </Alert>
      ) : (
        <Alert tone="danger" title="Nothing was saved">
          {outcome.message}
        </Alert>
      )}

      {state.rows.length === 0 ? (
        <EmptyState
          title="Nothing is missing"
          description="Every required field has a value for everybody it applies to."
        />
      ) : filling !== null ? (
        <>
          <DataTable
            label="Missing values"
            rows={rows}
            columns={columns}
            rowId={(r) => r.personId}
            empty={<EmptyState title="Nobody is missing anything" />}
          />
          <p className="text-sm text-fg-muted">
            Tab moves across, ↵ moves down. Nothing is saved until you press Save.
          </p>
        </>
      ) : (
        <>
          <DataTable
            label="Missing information"
            rows={state.rows}
            columns={list}
            rowId={rowId}
            containerClassName="touch:hidden"
            empty={<EmptyState title="Nobody is missing anything" />}
          />
          <List aria-label="Missing information" className="hidden touch:block">
            {state.rows.map((r) => (
              <ListItem
                key={rowId(r)}
                leading={<Avatar size="lg" name={r.name} />}
                description={`Missing: ${missingOf(r).join(', ')}`}
                trailing={action(r)}
              >
                {r.name}
              </ListItem>
            ))}
          </List>
        </>
      )}
      {onNextPage === undefined && onFirstPage === undefined ? null : (
        <nav aria-label="Pages of people" className="flex justify-end gap-2">
          {onFirstPage === undefined ? null : <Button onClick={onFirstPage}>First page</Button>}
          {onNextPage === undefined ? null : <Button onClick={onNextPage}>Next page</Button>}
        </nav>
      )}
    </Stack>
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** "21 Sep": when, to the day. */
const shortDay = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

/** "1 reminder", "40 reminders". */
const n = (count: number, one: string, many: string): string =>
  `${count.toLocaleString('en-GB')} ${count === 1 ? one : many}`;

/** What "Remind N people" did, in words: who was sent one, and who was not and why. */
function remindedText(r: Extract<RemindOutcome, { ok: true }>): string {
  return [
    r.sent === 0 ? 'Nobody was due a reminder.' : `Sent ${n(r.sent, 'reminder', 'reminders')}.`,
    r.failed === 0 ? '' : `${n(r.failed, 'email', 'emails')} could not be sent.`,
    r.skipped === 0
      ? ''
      : `${n(r.skipped, 'person was', 'people were')} not due: reminded in the last week, outside their working hours, or with no work email.`,
  ]
    .filter((line) => line !== '')
    .join(' ');
}
