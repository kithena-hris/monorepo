import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  DataTable,
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  EmptyState,
  ListItem,
  VirtualList,
  PageSection,
  Progress,
  Sparkline,
  Stack,
  Stat,
  icons,
  useScreenCommand,
  type ChartPoint,
  type DataColumn,
  type DataTableHandle,
  type VirtualRowProps,
  type RowAction,
} from '@reach/ui';
import {
  memo,
  useCallback,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type JSX,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

import { useHeldAtOnce } from '../held';
import type { Checked, IdentifierFinding, Outcome } from '../load';
import { AttributeControl, PeopleSearch, type SearchPeople } from '../record/attribute-input';
import { isMissing, type AttributeValue, type RecordField, type Values } from '../record/model';
import { SectionForm } from '../record/section-form';
import type { DataType } from '../settings/model';

/** A field somebody is missing: HR's to fill in, or the person's own. */
export interface GapField {
  readonly key: string;
  readonly label: string;
  /**
   * What kind of value it takes, so it is filled in with that kind's own
   * control. Absent from an older People: a person, a list, or text.
   */
  readonly dataType?: DataType;
  /** ISO 4217, for a money field fixed to one currency. */
  readonly currency?: string | null;
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
  /** The first page of people missing something. */
  readonly rows: readonly GapRow[];
  /** The cursor for the people after these; null or absent when these are all. */
  readonly next?: string | null;
  /**
   * The rows of the person the address fills in for (`?fill=`), read on
   * their own when they are not on the first page; absent otherwise.
   */
  readonly named?: readonly GapRow[] | null;
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

/** The people after a page, as the shell reads them (`onLoadMore`). */
export interface CompletenessPage {
  readonly rows: readonly GapRow[];
  readonly fields: readonly GapField[];
  readonly next: string | null;
}

/** One person's answers, however many fields they cover: one write, one event. */
export interface GridSave {
  readonly personId: string;
  /** Each as a form holds it: a date, a choice, several, a flag, money in minor units. */
  readonly values: Values;
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

/** `fill` for the grid over everybody's HR gaps, rather than one person's. */
export const FILL_ALL = 'all';

/** What Review's Missing details may do (design E6, E7). */
export interface MissingActions {
  readonly onSave: (changes: readonly GridSave[]) => Promise<GridOutcome>;
  /**
   * What our checks would warn about a national identifier in these cells,
   * before they are saved (PEO-125). Absent: save straight away.
   */
  readonly onCheck?: (changes: readonly GridSave[]) => Promise<GridOutcome>;
  /** The people after `after`, for the infinite list; absent, the first page is all. */
  readonly onLoadMore?: (after: string) => Promise<CompletenessPage | null>;
  /** Everybody due a reminder, now, through the weekly sweep. Absent: no button. */
  readonly onRemindAll?: () => Promise<RemindOutcome>;
  /** One person, asked for their own missing fields. Absent: no Remind on a row. */
  readonly onRemind?: (
    personId: string,
    keys: readonly string[],
  ) => Promise<{ readonly ok: true } | { readonly ok: false; readonly message: string }>;
  /**
   * What is being filled in (`?fill=`): `all`, the grid over every gap HR
   * fills; a person's id, the dialog for theirs; null, the list. Kept by the
   * host, so a link opens it; kept here without one.
   */
  readonly fill?: string | null;
  readonly onFillChange?: (fill: string | null) => void;
  /** How many values were filled in here, for a count drawn outside (Review's chip). */
  readonly onFilled?: (count: number) => void;
  /** When the page was read (epoch ms): what "reminded within the day" is measured from, the same on the server and in the browser. */
  readonly now?: number;
}

/**
 * Review's Missing details (design E6, E7, MA E5; PRD §8.4).
 *
 * First who is missing what, one row a person, as a list to read, scrolling
 * on through everybody a page ahead of the reader (keyset, PEO-122) with only
 * the rows on screen drawn. A row HR fills has "Fill in", a dialog over that
 * person's gaps alone; "Fill in for all" opens the grid over every gap HR
 * fills, one column a field and one row a person, so the keyboard runs down a
 * column. Either way each cell is the control its field's data type takes
 * (`AttributeControl`, the profile's own), and a save sends one change per
 * person, however many fields were filled for them, so each person raises
 * one `profile_updated`.
 *
 * A person's own gaps are a row of their own, "Remind" rather than "Fill
 * in": HR cannot type somebody's bank account for them, only ask. "Remind N
 * people" runs the weekly reminder now for everybody due one; the week's cap
 * still holds, so pressing it twice sends nothing twice.
 */
export function MissingDetails({
  state,
  searchPeople,
  ...props
}: MissingActions & {
  readonly state: CompletenessState;
  /** Finds people for a person field, by name, over everybody (PEO-122). */
  readonly searchPeople?: SearchPeople | undefined;
}): JSX.Element {
  return (
    <PeopleSearch.Provider value={searchPeople ?? null}>
      <Missing state={state} {...props} />
    </PeopleSearch.Provider>
  );
}

/* ------------------------------------------------------------ fields -- */

/** A gap's field as a record's, so it is drawn by the profile's own control. */
function recordFieldOf(f: GapField): RecordField {
  return {
    key: f.key,
    label: f.label,
    description: null,
    dataType: f.dataType ?? (f.person ? 'person_ref' : f.options.length > 0 ? 'select' : 'text'),
    options: f.options,
    // Each is required of this person and empty, which the dialog says once
    // rather than on every field; HR may fill some and leave the rest.
    required: false,
    readOnly: false,
    ...(f.currency == null ? {} : { currency: f.currency }),
    ...(f.sensitive === true ? { sensitive: true } : {}),
  };
}

/** Only what was given: an emptied cell is not a value to write. */
const given = (values: Values): Values =>
  Object.fromEntries(Object.entries(values).filter(([, v]) => !isMissing(v)));

/* ------------------------------------------------------------- pages -- */

const rowId = (r: GapRow): string => `${r.personId}-${r.owner}`;

/**
 * Everybody missing something: the first page as the shell drew it, then each
 * page after it as the reader nears the end. A cursor is asked for once. A
 * new first page (the shell read again) starts over.
 */
function usePages(state: CompletenessState, onLoadMore: MissingActions['onLoadMore']) {
  const [more, setMore] = useState<{ rows: GapRow[]; fields: GapField[]; next: string | null }>({
    rows: [],
    fields: [],
    next: state.next ?? null,
  });
  const [loading, setLoading] = useState(false);
  const [first, setFirst] = useState(state);
  if (first !== state) {
    setFirst(state);
    setMore({ rows: [], fields: [], next: state.next ?? null });
  }
  const asked = useRef(new Set<string>());
  const loadMore =
    onLoadMore === undefined || more.next === null || loading
      ? undefined
      : () => {
          const after = more.next;
          if (after === null || asked.current.has(after)) return;
          asked.current.add(after);
          setLoading(true);
          void onLoadMore(after).then((page) => {
            setLoading(false);
            // Nothing came: not asked again on its own, which a list too short
            // to scroll would do in a loop. The next read of the page starts over.
            if (page === null) return;
            setMore((m) =>
              m.next !== after
                ? m
                : {
                    rows: [...m.rows, ...page.rows],
                    fields: [...m.fields, ...page.fields],
                    next: page.next,
                  },
            );
          });
        };
  const rows = useMemo(() => {
    const seen = new Set<string>();
    return [...state.rows, ...more.rows].filter((r) => {
      const id = rowId(r);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }, [state.rows, more.rows]);
  const fields = useMemo(() => {
    const byKey = new Map<string, GapField>();
    for (const f of [...state.fields, ...more.fields]) {
      if (!byKey.has(f.key)) byKey.set(f.key, f);
    }
    return byKey;
  }, [state.fields, more.fields]);
  return { rows, fields, loading, loadMore, done: more.next === null };
}

/* ------------------------------------------------------------- edits -- */

/**
 * The grid's typed-in values, outside React's state: a cell reads its own
 * value and its own warning, so typing in one re-renders that cell and the
 * Save button, never the table.
 */
function createEdits() {
  let edits: Readonly<Record<string, Values>> = {};
  let findings: readonly GridFinding[] = [];
  const listeners = new Set<() => void>();
  const emit = (): void => {
    for (const listener of listeners) listener();
  };
  return {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    edits: () => edits,
    findings: () => findings,
    set: (personId: string, key: string, value: AttributeValue): void => {
      edits = { ...edits, [personId]: { ...edits[personId], [key]: value } };
      // A changed value is not the one our checks doubted: Save checks again.
      findings = [];
      emit();
    },
    warn: (found: readonly GridFinding[]): void => {
      findings = found;
      emit();
    },
    clear: (): void => {
      edits = {};
      findings = [];
      emit();
    },
  };
}
type Edits = ReturnType<typeof createEdits>;

/** How many values are typed in, waiting for Save. */
const countOf = (edits: Readonly<Record<string, Values>>): number =>
  Object.values(edits).reduce((n, v) => n + Object.keys(given(v)).length, 0);

/** The changes a save sends: one per person, only what was given. */
const changesOf = (edits: Readonly<Record<string, Values>>): GridSave[] =>
  Object.entries(edits)
    .map(([personId, values]) => ({ personId, values: given(values) }))
    .filter((c) => Object.keys(c.values).length > 0);

const doubt = (messages: readonly string[]): string | undefined =>
  messages.length === 0 ? undefined : `Our checks suggest this may be wrong: ${messages.join(' ')}`;

/* ------------------------------------------------------------ screen -- */

function Missing({
  state,
  onSave,
  onCheck,
  onLoadMore,
  onRemindAll,
  onRemind,
  fill: heldFill,
  onFillChange,
  onFilled,
  now,
}: MissingActions & { readonly state: CompletenessState }): JSX.Element {
  const [fill, setFill] = useHeldAtOnce<string | null>(heldFill, onFillChange, heldFill ?? null);
  const pages = usePages(state, onLoadMore);
  /** Values saved here, by person: no longer missing, though the page was read before. */
  const [filled, setFilled] = useState<Readonly<Record<string, readonly string[]>>>({});
  const [first, setFirst] = useState(state);
  if (first !== state) {
    setFirst(state);
    setFilled({});
  }
  const [outcome, setOutcome] = useState<{ readonly text: string; readonly ok: boolean } | null>(
    null,
  );
  const [reminding, setReminding] = useState(false);
  const [reminded, setReminded] = useState<RemindOutcome | null>(null);
  /** Rows reminded from here, by row id: null once sent, or why it was not. */
  const [asked, setAsked] = useState<Readonly<Record<string, string | null>>>({});

  const rows = useMemo(
    () =>
      pages.rows
        .map((r) => {
          const done = r.owner === 'hr' ? filled[r.personId] : undefined;
          return done === undefined
            ? r
            : { ...r, missing: r.missing.filter((k) => !done.includes(k)) };
        })
        .filter((r) => r.missing.length > 0),
    [pages.rows, filled],
  );
  const hrRows = useMemo(() => rows.filter((r) => r.owner === 'hr'), [rows]);
  const filledCount = Object.values(filled).reduce((n, keys) => n + keys.length, 0);
  const toFill = Math.max(0, state.toFill - filledCount);
  const labelOf = (key: string): string => pages.fields.get(key)?.label ?? key;

  /** After a save: what is no longer missing, and the words for it. */
  const saved = (
    changes: readonly GridSave[],
    result: Extract<GridOutcome, { ok: true }>,
    who: string | null,
  ): void => {
    // A sensitive value waits for approval: still missing until it is applied.
    const applied = changes.map((c) => ({
      personId: c.personId,
      keys: Object.keys(c.values).filter((k) => pages.fields.get(k)?.sensitive !== true),
    }));
    const count = applied.reduce((n, c) => n + c.keys.length, 0);
    setFilled((f) => {
      const next = { ...f };
      for (const c of applied) next[c.personId] = [...(next[c.personId] ?? []), ...c.keys];
      return next;
    });
    onFilled?.(filledCount + count);
    const held = result.held ?? 0;
    const reviewed = (result.findings ?? []).filter((f) => f.review === 'pending').length;
    setOutcome({
      ok: true,
      text: [
        who === null
          ? 'Saved. Each person’s record now carries what you filled in.'
          : `Saved. ${who}’s record now carries what you filled in.`,
        held > 0
          ? `${String(held)} ${held === 1 ? 'value waits' : 'values wait'} for HR’s approval and ${held === 1 ? 'is' : 'are'} not applied until then.`
          : '',
        reviewed > 0
          ? `${String(reviewed)} ${reviewed === 1 ? 'value our checks doubted went' : 'values our checks doubted went'} to HR’s review.`
          : '',
      ]
        .filter((x) => x !== '')
        .join(' '),
    });
  };

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
  const lastReminded = state.waiting.lastReminded;
  const recently = useCallback(
    (r: GapRow): boolean =>
      asked[rowId(r)] === null ||
      (r.remindedAt !== null &&
        (now ?? Date.parse(lastReminded ?? '')) - Date.parse(r.remindedAt) < DAY_MS),
    [asked, now, lastReminded],
  );

  const due = state.waiting.due ?? 0;
  const canRemindAll = onRemindAll !== undefined && due > 0;
  // The shell's palette runs both: "Remind 12 people waiting", "Fill in for all".
  useScreenCommand(
    !canRemindAll || fill !== null
      ? null
      : {
          id: 'remind',
          label: `Remind ${peopleCount(due)} waiting`,
          run: () => {
            void remindAll();
          },
        },
  );
  useScreenCommand(
    hrRows.length === 0 || fill === FILL_ALL
      ? null
      : {
          id: 'fill-all',
          label: 'Fill in for all',
          run: () => {
            setFill(FILL_ALL);
          },
        },
  );

  const notices = (
    <>
      {reminded === null ? null : reminded.ok ? (
        <Alert tone="success">{remindedText(reminded)}</Alert>
      ) : (
        <Alert tone="danger" title="Nobody was reminded">
          {reminded.message}
        </Alert>
      )}
      {((): ReactNode => {
        const failed = Object.values(asked).find((message) => message !== null);
        return failed == null ? null : (
          <Alert tone="danger" title="That reminder was not sent">
            {failed}
          </Alert>
        );
      })()}
      {outcome === null ? null : outcome.ok ? (
        <Alert tone="success">{outcome.text}</Alert>
      ) : (
        <Alert tone="danger" title="Nothing was saved">
          {outcome.text}
        </Alert>
      )}
    </>
  );

  // The table's columns and row actions, held between renders: a page
  // landing redraws only the rows it brought, and a reminder only redraws
  // with what it changed (`recently`). The rest is read from `live` when used.
  const live = useRef({ labelOf, remind, setFill });
  live.current = { labelOf, remind, setFill };
  const fillIn = useCallback((r: GapRow): void => {
    setOutcome(null);
    live.current.setFill(r.personId);
  }, []);
  const action = useCallback(
    (r: GapRow): JSX.Element | null =>
      r.owner === 'hr' ? (
        <Button
          size="sm"
          variant="primary"
          aria-label={`Fill in ${r.name}`}
          shortcut="row.fill"
          onClick={() => {
            fillIn(r);
          }}
        >
          Fill in
        </Button>
      ) : onRemind === undefined ? null : recently(r) ? (
        <Button size="sm" variant="ghost" disabled aria-label={`Reminded ${r.name}`}>
          Reminded
        </Button>
      ) : (
        <Button
          size="sm"
          aria-label={`Remind ${r.name}`}
          shortcut="row.remind"
          onClick={() => {
            void live.current.remind(r);
          }}
        >
          Remind
        </Button>
      ),
    [fillIn, onRemind, recently],
  );
  // The row's own action, from its menu or its key: F fills in HR's gaps, R reminds a person.
  const rowActions = useCallback(
    (r: GapRow): readonly RowAction[] =>
      r.owner === 'hr'
        ? [
            {
              id: 'fill',
              label: 'Fill in',
              shortcut: 'row.fill',
              icon: <icons.edit aria-hidden />,
              onSelect: () => {
                fillIn(r);
              },
            },
          ]
        : onRemind === undefined
          ? []
          : [
              {
                id: 'remind',
                label: recently(r) ? 'Reminded' : 'Remind',
                shortcut: 'row.remind',
                icon: <icons.notifications aria-hidden />,
                disabled: recently(r),
                onSelect: () => {
                  void live.current.remind(r);
                },
              },
            ],
    [fillIn, onRemind, recently],
  );
  // A phone row, held between renders like the table's columns, so a scroll
  // or a page landing redraws only the rows it brings (`VirtualList`).
  const phoneRow = useCallback(
    (r: GapRow, _i: number, item: VirtualRowProps) => (
      <ListItem
        key={rowId(r)}
        {...item}
        leading={<Avatar size="lg" name={r.name} />}
        description={`Missing: ${r.missing.map(live.current.labelOf).join(', ')}`}
        trailing={action(r)}
      >
        {r.name}
      </ListItem>
    ),
    [action],
  );
  const columns = useMemo(
    (): DataColumn<GapRow>[] => [
      { id: 'person', header: 'Person', width: '15rem', cell: (r) => <PersonCell row={r} /> },
      {
        id: 'missing',
        header: 'Missing',
        cell: (r) => (
          <span className="flex flex-wrap gap-1.5">
            {r.missing.map(live.current.labelOf).map((label) => (
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
        cell: (r) => <WhoFills owner={r.owner} />,
      },
      { id: 'act', header: <span className="sr-only">Action</span>, width: '8rem', cell: action },
    ],
    [action],
  );

  if (fill === FILL_ALL) {
    return (
      <FillGrid
        rows={hrRows}
        fields={pages.fields}
        toFill={toFill}
        everybody={pages.done}
        loadMore={pages.loadMore}
        loading={pages.loading}
        notices={notices}
        onSave={onSave}
        onCheck={onCheck}
        onSaved={(changes, result) => {
          saved(changes, result, null);
        }}
        onFailed={(message) => {
          setOutcome({ ok: false, text: message });
        }}
        onBack={() => {
          setFill(null);
        }}
      />
    );
  }

  // The person "Fill in" was pressed for, or a link named.
  const person =
    fill === null
      ? undefined
      : (hrRows.find((r) => r.personId === fill) ??
        state.named?.find((r) => r.owner === 'hr' && r.personId === fill && !filled[r.personId]));

  const change = state.complete?.change ?? null;
  const trend = state.complete?.trend ?? [];
  const empty = (
    <EmptyState icon={<icons.missing />} title={NOTHING.title} description={NOTHING.body} />
  );
  return (
    <Stack gap={4}>
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
        <Stat label="For HR to fill in" value={toFill} description="Fill them in below" />
        {state.blocking === null ? null : (
          <Stat
            label="Blocking payroll"
            value={state.blocking}
            description="Bank, tax or ID details"
          />
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
          {state.waiting.people.toLocaleString('en-GB')} waiting on employees ·{' '}
          {toFill.toLocaleString('en-GB')} for HR
        </p>
      </Card>

      {notices}

      {rows.length === 0 ? (
        <Card padded>{empty}</Card>
      ) : (
        <PageSection
          surface
          title="Missing information"
          // A desk's (V4): on a phone each row carries its own Remind and Fill in (MV2).
          actions={
            canRemindAll || hrRows.length > 0 ? (
              <span className="flex flex-wrap gap-2 touch:hidden">
                {canRemindAll ? (
                  <Button
                    size="sm"
                    startIcon={<icons.notifications aria-hidden />}
                    loading={reminding}
                    loadingLabel="Sending"
                    onClick={() => {
                      void remindAll();
                    }}
                  >
                    Remind {peopleCount(due)}
                  </Button>
                ) : null}
                {hrRows.length > 0 ? (
                  <Button
                    size="sm"
                    variant="primary"
                    startIcon={<icons.edit aria-hidden />}
                    onClick={() => {
                      setOutcome(null);
                      setFill(FILL_ALL);
                    }}
                  >
                    Fill in for all
                  </Button>
                ) : null}
              </span>
            ) : undefined
          }
        >
          <DataTable
            label="Missing information"
            rows={rows}
            columns={columns}
            rowId={rowId}
            describeRow={(r) => r.name}
            rowActions={rowActions}
            // Infinite: the table scrolls in a box of its own the height the
            // window has left, the next page loads near its end, and only
            // the rows on screen are drawn.
            containerClassName="page-fill max-h-dvh min-h-96 touch:hidden"
            {...(pages.loadMore === undefined ? {} : { onEndReached: pages.loadMore })}
            loadingMore={pages.loading}
            virtualize
            empty={empty}
          />
          {/* A phone's list: the page is its scroll, only the rows near the view are
              drawn, and the next people load a screen ahead (not while a dialog is open). */}
          <div className="hidden touch:block">
            <VirtualList
              label="Missing information"
              items={rows}
              itemKey={rowId}
              scroll="page"
              listItems
              estimateItemHeight={PHONE_ROW}
              {...(fill !== null || pages.loadMore === undefined
                ? {}
                : { onEndReached: pages.loadMore })}
              loadingMore={pages.loading}
              renderItem={phoneRow}
            />
          </div>
        </PageSection>
      )}
      {person === undefined ? null : (
        <PersonFill
          row={person}
          fields={pages.fields}
          onSave={onSave}
          onCheck={onCheck}
          onSaved={(changes, result) => {
            saved(changes, result, person.name);
            setFill(null);
          }}
          onClose={() => {
            setFill(null);
          }}
        />
      )}
    </Stack>
  );
}

const NOTHING = {
  title: 'Nothing is missing',
  body: 'Every required field has a value for everybody it applies to.',
};

/** A phone row's height, for the list to place rows it has not measured yet. */
const PHONE_ROW = 72;

function PersonCell({ row }: { readonly row: GapRow }): JSX.Element {
  return (
    <span className="flex items-center gap-2.5">
      <Avatar size="md" name={row.name} />
      <span className="min-w-0">
        <span className="block truncate font-semibold">{row.name}</span>
        <span className="block truncate text-xs text-fg-muted">
          {[row.department, row.manager].filter((x) => x !== null).join(' · ')}
        </span>
      </span>
    </span>
  );
}

function WhoFills({ owner }: { readonly owner: GapRow['owner'] }): JSX.Element {
  return owner === 'hr' ? (
    <Badge size="sm" tone="accent">
      HR
    </Badge>
  ) : (
    <Badge size="sm">Employee</Badge>
  );
}

/* --------------------------------------------------- one person (E6) -- */

/**
 * "Fill in" on a row: that person's gaps HR fills, and nothing else, in a
 * centred dialog. The profile's own form (`SectionForm`): the control each
 * field's type takes, Save, and a doubted identifier warned about with "Save
 * anyway" (PEO-125). Open in the address (`?fill=<person>`), so the server
 * sends it open.
 */
function PersonFill({
  row,
  fields,
  onSave,
  onCheck,
  onSaved,
  onClose,
}: {
  readonly row: GapRow;
  readonly fields: ReadonlyMap<string, GapField>;
  readonly onSave: MissingActions['onSave'];
  readonly onCheck: MissingActions['onCheck'];
  readonly onSaved: (
    changes: readonly GridSave[],
    result: Extract<GridOutcome, { ok: true }>,
  ) => void;
  readonly onClose: () => void;
}): JSX.Element {
  const shown = row.missing.flatMap((key) => {
    const f = fields.get(key);
    return f === undefined ? [] : [recordFieldOf(f)];
  });
  const details = `${String(shown.length)} ${shown.length === 1 ? 'detail' : 'details'}`;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-140">
        <DialogHeader>
          <DialogTitle>{`Fill in for ${row.name}`}</DialogTitle>
          <DialogDescription>
            {`${details} HR keeps. Nothing is saved until you press Save.`}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <SectionForm
            section={{
              key: 'missing',
              label: `Missing details for ${row.name}`,
              visibility: [],
              fields: shown,
            }}
            values={{}}
            hint="Sensitive values wait for approval."
            footer={
              <DialogClose asChild>
                <Button variant="ghost">Cancel</Button>
              </DialogClose>
            }
            onSave={async (_section, changed): Promise<Outcome> => {
              const changes = changesOf({ [row.personId]: changed });
              if (changes.length === 0) {
                onClose();
                return { ok: true };
              }
              const result = await onSave(changes);
              if (!result.ok) return result;
              onSaved(changes, result);
              return { ok: true };
            }}
            {...(onCheck === undefined
              ? {}
              : {
                  onCheck: async (_section: string, changed: Values): Promise<Checked> => {
                    const checked = await onCheck(changesOf({ [row.personId]: changed }));
                    return checked.ok ? { ok: true, findings: checked.findings ?? [] } : checked;
                  },
                })}
          />
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

/* --------------------------------------------------- everybody (E7) -- */

/**
 * "Fill in for all" (E7): HR's rows only, and only the fields somebody
 * listed is missing, one column each; a filled cell is "—". Tab moves across,
 * ↵ down the column. Each person's edits go out as one change.
 */
function FillGrid({
  rows,
  fields,
  toFill,
  everybody,
  loadMore,
  loading,
  notices,
  onSave,
  onCheck,
  onSaved,
  onFailed,
  onBack,
}: {
  readonly rows: readonly GapRow[];
  readonly fields: ReadonlyMap<string, GapField>;
  readonly toFill: number;
  /** Every person is loaded: "across N people" is then a count, not a guess. */
  readonly everybody: boolean;
  readonly loadMore: (() => void) | undefined;
  readonly loading: boolean;
  readonly notices: ReactNode;
  readonly onSave: MissingActions['onSave'];
  readonly onCheck: MissingActions['onCheck'];
  readonly onSaved: (
    changes: readonly GridSave[],
    result: Extract<GridOutcome, { ok: true }>,
  ) => void;
  readonly onFailed: (message: string) => void;
  readonly onBack: () => void;
}): JSX.Element {
  const [edits] = useState(createEdits);
  const [saving, setSaving] = useState(false);
  const pending = useSyncExternalStore(
    edits.subscribe,
    () => countOf(edits.edits()),
    () => 0,
  );
  const doubted = useSyncExternalStore(edits.subscribe, edits.findings, edits.findings);
  const table = useRef<DataTableHandle>(null);
  const placed = useRef(rows);
  placed.current = rows;

  // Each field drawn once, so a cell's props stay the same as pages arrive.
  const asRecord = useMemo(
    () => new Map([...fields].map(([key, f]) => [key, { gap: f, field: recordFieldOf(f) }])),
    [fields],
  );
  // Only the fields somebody listed is missing: a column of nothing is noise.
  const shown = useMemo(
    () => [...asRecord.values()].filter(({ gap }) => rows.some((r) => r.missing.includes(gap.key))),
    [asRecord, rows],
  );
  const columns = useMemo(
    (): DataColumn<GapRow>[] => [
      {
        id: 'person',
        header: 'Person',
        width: '15rem',
        sticky: true,
        cell: (r) => <PersonCell row={r} />,
      },
      ...shown.map(({ gap, field }): DataColumn<GapRow> => ({
        id: field.key,
        header:
          gap.sensitive === true ? (
            <span className="inline-flex items-center gap-2">
              {field.label}
              <Badge tone="sensitive" size="sm">
                Sensitive
              </Badge>
            </span>
          ) : (
            field.label
          ),
        cell: (r) =>
          r.missing.includes(field.key) ? (
            <Cell edits={edits} row={r} field={field} />
          ) : (
            <span className="text-fg-subtle" aria-label="Already filled in">
              —
            </span>
          ),
      })),
    ],
    [shown, edits],
  );

  /** ↵ in a line moves to the same field on the next row that is missing it, as a sheet does. */
  const down = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Enter' || event.defaultPrevented || event.metaKey || event.ctrlKey) return;
    const target = event.target as HTMLElement;
    if (target.tagName !== 'INPUT' || target.getAttribute('role') === 'combobox') return;
    const at = target.closest<HTMLElement>('[data-cell]');
    if (at === null) return;
    event.preventDefault();
    const personId = at.dataset['person'] ?? '';
    const key = at.dataset['cell'] ?? '';
    const list = placed.current;
    const next = list
      .slice(list.findIndex((r) => r.personId === personId) + 1)
      .find((r) => r.missing.includes(key));
    if (next === undefined) return;
    table.current?.revealRow(next.personId);
    // A row scrolled out of the DOM mounts once the scroll nears it.
    let frames = 0;
    const land = (): void => {
      const cell = document.getElementById(cellId(next.personId, key));
      if (cell !== null) cell.focus();
      else if (frames++ < 60) requestAnimationFrame(land);
    };
    land();
  };

  const save = async (): Promise<void> => {
    const changes = changesOf(edits.edits());
    if (changes.length === 0) return;
    setSaving(true);
    if (onCheck !== undefined && edits.findings().length === 0) {
      const checked = await onCheck(changes);
      if (!checked.ok) {
        setSaving(false);
        onFailed(checked.message);
        return;
      }
      // A value HR already accepted is final: nothing to warn about (PEO-125).
      const found = (checked.findings ?? []).filter((f) => f.review !== 'accepted');
      if (found.length > 0) {
        setSaving(false);
        edits.warn(found);
        return;
      }
    }
    const result = await onSave(changes);
    setSaving(false);
    if (!result.ok) {
      onFailed(result.message);
      return;
    }
    edits.clear();
    onSaved(changes, result);
  };

  const people = rows.length;
  return (
    <Stack gap={4}>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-xl font-bold tracking-tight">Fill in for HR</h2>
          <p className="text-sm text-fg-muted">
            {`${toFill.toLocaleString('en-GB')} ${toFill === 1 ? 'detail' : 'details'}${
              everybody ? ` across ${peopleCount(people)}` : ''
            }. Tab moves across, ↵ moves down. Nothing is saved until you press Save.`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" startIcon={<icons.back aria-hidden />} onClick={onBack}>
            Back to the list
          </Button>
          <Button
            variant="primary"
            disabled={pending === 0}
            loading={saving}
            loadingLabel="Saving"
            shortcut="form.submit"
            onClick={() => {
              void save();
            }}
          >
            {doubted.length > 0
              ? 'Save anyway'
              : pending === 0
                ? 'Save'
                : `Save ${String(pending)} ${pending === 1 ? 'change' : 'changes'}`}
          </Button>
        </div>
      </div>
      {notices}
      {doubted.length === 0 ? null : (
        <Alert tone="warning" title="Our checks suggest some of these may be wrong">
          Check the marked cells. If they’re correct, save anyway and HR will review them.
        </Alert>
      )}
      {rows.length === 0 ? (
        <Card padded>
          <EmptyState
            icon={<icons.missing />}
            title="Nothing for HR to fill in"
            description="Every gap left is a person’s own: remind them from the list."
          />
        </Card>
      ) : (
        // ↵ is caught here, once, for every line in the grid.
        <div onKeyDown={down} className="contents">
          <DataTable
            ref={table}
            label="Missing values"
            rows={rows}
            columns={columns}
            rowId={(r) => r.personId}
            containerClassName="page-fill max-h-dvh min-h-96"
            {...(loadMore === undefined ? {} : { onEndReached: loadMore })}
            loadingMore={loading}
            virtualize
          />
        </div>
      )}
      <p className="text-sm text-fg-muted">
        Each person’s edits go out as one change. Sensitive values wait for approval; doubted
        identifiers go to HR’s review.
      </p>
    </Stack>
  );
}

const cellId = (personId: string, key: string): string => `cell-${personId}-${key}`;

/**
 * One empty cell: the control its field's type takes, reading and writing
 * its own value in the grid's edits, so typing here re-renders this cell
 * alone.
 */
const Cell = memo(function Cell({
  edits,
  row,
  field,
}: {
  readonly edits: Edits;
  readonly row: GapRow;
  readonly field: RecordField;
}): JSX.Element {
  const value = useSyncExternalStore(
    edits.subscribe,
    () => edits.edits()[row.personId]?.[field.key] ?? null,
    () => null,
  );
  const warning = useSyncExternalStore(
    edits.subscribe,
    () =>
      doubt(
        edits
          .findings()
          .filter((f) => f.personId === row.personId && f.key === field.key)
          .map((f) => f.message),
      ),
    () => undefined,
  );
  return (
    <div data-cell={field.key} data-person={row.personId} className="min-w-32">
      <AttributeControl
        field={field}
        value={value}
        label={`${field.label} for ${row.name}`}
        cell={{ id: cellId(row.personId, field.key), warning }}
        onChange={(next) => {
          edits.set(row.personId, field.key, next);
        }}
      />
    </div>
  );
});

/* ------------------------------------------------------------- words -- */

const DAY_MS = 24 * 60 * 60 * 1000;

/** "21 Sep": when, to the day. */
const shortDay = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/** "1 reminder", "40 reminders". */
const n = (count: number, one: string, many: string): string =>
  `${count.toLocaleString('en-GB')} ${count === 1 ? one : many}`;

/** "12 people", "1 person". */
const peopleCount = (count: number): string => n(count, 'person', 'people');

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
