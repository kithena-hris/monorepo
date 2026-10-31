import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  type ChartPoint,
  type DataColumn,
  DataTable,
  type DataTableHandle,
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  EmptyState,
  icons,
  InlineCell,
  ListItem,
  SearchField,
  SegmentedControl,
  SegmentedControlItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Toolbar,
  locale,
  Progress,
  Stack,
  useScreenCommand,
  VirtualList,
  type VirtualRowProps,
} from '@reach/ui';
import {
  memo,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type JSX,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

import { useHeldAtOnce, useTyped } from '../held';
import type { Checked, IdentifierFinding, Outcome } from '../load';
import { AttributeControl, PeopleSearch, type SearchPeople } from '../record/attribute-input';
import { isMissing, type AttributeValue, type RecordField, type Values } from '../record/model';
import { SectionForm } from '../record/section-form';
import type { DataType } from '../settings/model';
import { t } from '../i18n';

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
  /**
   * The rows Missing details lists over everybody (a person HR fills for, a
   * person waiting on themselves): what Review's chip counts. Absent from an older People.
   */
  readonly listed?: number;
  /** Of those, the people HR fills something in for. Absent from an older People. */
  readonly hrListed?: number;
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

/** The list's view, as the address holds it: null for the default. */
export interface MissingView {
  readonly lane: string | null;
  readonly q: string | null;
  readonly team: string | null;
  readonly field: string | null;
  readonly group: string | null;
}

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
  /**
   * How the list is seen: its lane, search, filters and grouping, from the
   * address (`?lane=`, `?q=`, `?team=`, `?field=`, `?group=`), so a link opens
   * it. Kept here without a host.
   */
  readonly view?: MissingView;
  readonly onViewChange?: (patch: Partial<MissingView>) => void;
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
 * page after it as the reader nears the end. A cursor is asked for once.
 *
 * The shell reads the page again after every save. That first page replaces
 * the old one and the pages after it stay, so the reader keeps the rows and
 * the place they had: starting over dropped the grid back to its first page
 * under them on every save. A row both carry is listed once, as read last.
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
    setMore((m) => (m.rows.length === 0 ? { rows: [], fields: [], next: state.next ?? null } : m));
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
            setMore((m) => {
              if (m.next !== after) return m;
              // Only a field not seen before: the same list, so the grid's
              // columns, and every cell drawn from them, hold as pages land.
              const known = new Set([...state.fields, ...m.fields].map((f) => f.key));
              const added = page.fields.filter((f) => !known.has(f.key));
              return {
                rows: [...m.rows, ...page.rows],
                fields: added.length === 0 ? m.fields : [...m.fields, ...added],
                next: page.next,
              };
            });
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
  messages.length === 0
    ? undefined
    : t(
        'completeness.completeness-grid.our_checks_suggest_this_may_be',
        'Our checks suggest this may be wrong: {{join}}',
        { join: messages.join(' ') },
      );

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
  view,
  onViewChange,
  now,
}: MissingActions & { readonly state: CompletenessState }): JSX.Element {
  const [fill, setFill] = useHeldAtOnce<string | null>(heldFill, onFillChange, heldFill ?? null);
  const pages = usePages(state, onLoadMore);
  /**
   * Values saved here, by person: no longer missing, though a page kept from
   * before says they are. `since` counts those saved since the page was last
   * read, which its figures do not include yet.
   */
  const [saves, setSaves] = useState<{
    readonly filled: Readonly<Record<string, readonly string[]>>;
    readonly since: number;
  }>({ filled: {}, since: 0 });
  const filled = saves.filled;
  const [first, setFirst] = useState(state);
  if (first !== state) {
    setFirst(state);
    setSaves((f) => ({ filled: f.filled, since: 0 }));
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
  // Over everybody, less the rows filled in here since the page came.
  const cleared = pages.rows.length - rows.length;
  const listedTotal =
    state.listed === undefined ? undefined : Math.max(rows.length, state.listed - cleared);
  const hrTotal =
    state.hrListed === undefined
      ? undefined
      : Math.max(
          hrRows.length,
          state.hrListed - pages.rows.filter((r) => r.owner === 'hr').length + hrRows.length,
        );
  const toFill = Math.max(0, state.toFill - saves.since);
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
    setSaves((f) => {
      const next = { ...f.filled };
      for (const c of applied) next[c.personId] = [...(next[c.personId] ?? []), ...c.keys];
      return { filled: next, since: f.since + applied.reduce((n, c) => n + c.keys.length, 0) };
    });
    const held = result.held ?? 0;
    const reviewed = (result.findings ?? []).filter((f) => f.review === 'pending').length;
    setOutcome({
      ok: true,
      text: [
        who === null
          ? t(
              'completeness.completeness-grid.saved_each_persons_record_now_carries',
              'Saved. Each person’s record now carries what you filled in.',
            )
          : t(
              'completeness.completeness-grid.saved_s_record_now_carries_what',
              'Saved. {{who}}’s record now carries what you filled in.',
              { who },
            ),
        held > 0
          ? t(
              'completeness.completeness-grid.for_hrs_approval_and_not_applied',
              {
                one: '{{count}} value waits for HR’s approval and is not applied until then.',
                other: '{{count}} values wait for HR’s approval and are not applied until then.',
              },
              { count: held },
            )
          : '',
        reviewed > 0
          ? t(
              'completeness.completeness-grid.to_hrs_review',
              {
                one: '{{count}} value our checks doubted went to HR’s review.',
                other: '{{count}} values our checks doubted went to HR’s review.',
              },
              { count: reviewed },
            )
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
          label: t(
            'completeness.completeness-grid.remind_waiting',
            'Remind {{peopleCount}} waiting',
            { peopleCount: peopleCount(due) },
          ),
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
          label: t('completeness.completeness-grid.fill_in_for_all', 'Fill in for all'),
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
        <Alert
          tone="danger"
          title={t('completeness.completeness-grid.nobody_was_reminded', 'Nobody was reminded')}
        >
          {reminded.message}
        </Alert>
      )}
      {((): ReactNode => {
        const failed = Object.values(asked).find((message) => message !== null);
        return failed == null ? null : (
          <Alert
            tone="danger"
            title={t(
              'completeness.completeness-grid.that_reminder_was_not_sent',
              'That reminder was not sent',
            )}
          >
            {failed}
          </Alert>
        );
      })()}
      {outcome === null ? null : outcome.ok ? (
        <Alert tone="success">{outcome.text}</Alert>
      ) : (
        <Alert
          tone="danger"
          title={t('completeness.completeness-grid.nothing_was_saved', 'Nothing was saved')}
        >
          {outcome.text}
        </Alert>
      )}
    </>
  );

  // What each row does, held between renders: a page landing redraws only
  // the rows it brought, and a reminder only with what it changed (`recently`).
  const live = useRef({ labelOf, remind, setFill });
  live.current = { labelOf, remind, setFill };
  // Whether there is a Remind at all, not which function: the host's is new on
  // every render, and a row drawn from it redrew every row each time.
  const canRemind = onRemind !== undefined;
  const fillIn = useCallback((r: GapRow): void => {
    setOutcome(null);
    live.current.setFill(r.personId);
  }, []);
  const action = useCallback(
    (r: GapRow): JSX.Element | null =>
      r.owner === 'hr' ? (
        <Button
          size="sm"
          variant="secondary"
          startIcon={<icons.edit aria-hidden />}
          aria-label={t('completeness.completeness-grid.fill_in_2', 'Fill in {{name}}', {
            name: r.name,
          })}
          onClick={() => {
            fillIn(r);
          }}
        >
          {t('completeness.completeness-grid.fill_in', 'Fill in')}
        </Button>
      ) : !canRemind ? null : recently(r) ? (
        <Button
          size="sm"
          variant="ghost"
          disabled
          aria-label={t('completeness.completeness-grid.reminded_2', 'Reminded {{name}}', {
            name: r.name,
          })}
        >
          {t('completeness.completeness-grid.reminded', 'Reminded')}
        </Button>
      ) : (
        <Button
          size="sm"
          variant="secondary"
          startIcon={<icons.notifications aria-hidden />}
          aria-label={t('completeness.completeness-grid.remind_2', 'Remind {{name}}', {
            name: r.name,
          })}
          onClick={() => {
            void live.current.remind(r);
          }}
        >
          {t('completeness.completeness-grid.remind', 'Remind')}
        </Button>
      ),
    [fillIn, canRemind, recently],
  );

  /* ---------------------------------------- the view: lane, find, group -- */
  // Two lanes, by who fills the gap in: HR's own, or the person's, chased.
  // Each part of the view is in the address (`view`), so a link opens it.
  const employeeRows = useMemo(() => rows.filter((r) => r.owner !== 'hr'), [rows]);
  const employeeTotal =
    listedTotal === undefined || hrTotal === undefined
      ? undefined
      : Math.max(employeeRows.length, listedTotal - hrTotal);
  const [heldLane, setLane] = useHeldAtOnce<string | null>(
    view?.lane,
    onViewChange === undefined
      ? undefined
      : (lane) => {
          onViewChange({ lane });
        },
    view?.lane ?? null,
  );
  // Without a lane chosen, HR's own: theirs to do now; the other when HR has none.
  const lane: Lane =
    heldLane === 'employees' ||
    (heldLane !== 'hr' && hrRows.length === 0 && employeeRows.length > 0)
      ? 'employees'
      : 'hr';
  const [team, setTeam] = useHeldAtOnce<string | null>(
    view?.team,
    onViewChange === undefined
      ? undefined
      : (next) => {
          onViewChange({ team: next });
        },
    view?.team ?? null,
  );
  const [field, setField] = useHeldAtOnce<string | null>(
    view?.field,
    onViewChange === undefined
      ? undefined
      : (next) => {
          onViewChange({ field: next });
        },
    view?.field ?? null,
  );
  const [heldGroup, setGroup] = useHeldAtOnce<string | null>(
    view?.group,
    onViewChange === undefined
      ? undefined
      : (next) => {
          onViewChange({ group: next });
        },
    view?.group ?? null,
  );
  const group: GroupBy = GROUPS.find((g) => g === heldGroup) ?? 'none';
  const [query, type] = useTyped(
    view?.q ?? '',
    onViewChange === undefined
      ? undefined
      : (q) => {
          onViewChange({ q: q === '' ? null : q });
        },
  );
  const laneRows = lane === 'hr' ? hrRows : employeeRows;
  // The choices are what the lane holds, so a filter never offers an empty list.
  const teams = useMemo(
    () => [...new Set(laneRows.map((r) => r.department ?? ''))].sort((a, b) => a.localeCompare(b)),
    [laneRows],
  );
  const fieldsMissing = useMemo(() => {
    const by = new Map<string, number>();
    for (const r of laneRows) for (const k of r.missing) by.set(k, (by.get(k) ?? 0) + 1);
    return [...by].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  }, [laneRows]);
  const needle = query.trim().toLocaleLowerCase();
  const shown = useMemo(
    () =>
      laneRows.filter(
        (r) =>
          (team === null || (r.department ?? '') === team) &&
          (field === null || r.missing.includes(field)) &&
          (needle === '' || r.name.toLocaleLowerCase().includes(needle)),
      ),
    [laneRows, team, field, needle],
  );
  const narrowed = team !== null || field !== null || needle !== '';
  const items = useMemo(() => grouped(shown, group, live.current.labelOf), [shown, group]);
  const laneTotal = narrowed ? undefined : lane === 'hr' ? hrTotal : employeeTotal;

  // One row: who, what is missing, and the one thing to do, beside them.
  const listRow = useCallback(
    (entry: Entry, _i: number, item: VirtualRowProps) =>
      entry.kind === 'head' ? (
        <li
          key={entry.key}
          {...item}
          className="flex items-baseline justify-between gap-3 px-4 pt-5 pb-1.5 first:pt-2"
        >
          <span className="text-sm font-semibold text-fg">{entry.label}</span>
          <span className="text-xs text-fg-muted tabular-nums">{peopleCount(entry.count)}</span>
        </li>
      ) : (
        <ListItem
          key={entry.key}
          {...item}
          leading={<Avatar size="md" name={entry.row.name} />}
          description={missingText(entry.row.missing.map(live.current.labelOf))}
          {...(entry.row.department === null && entry.row.manager === null
            ? {}
            : {
                // Beside the name at a desk; on a phone the name has the line.
                meta: (
                  <span className="@max-md/page:hidden">
                    {[entry.row.department, entry.row.manager].filter((x) => x !== null).join(' · ')}
                  </span>
                ),
              })}
          trailing={action(entry.row)}
        >
          {entry.row.name}
        </ListItem>
      ),
    [action],
  );

  // Everybody's gaps HR fills, one grid: the whole page while it is open.
  if (fill === FILL_ALL) {
    return (
      <FillGrid
        rows={hrRows}
        fields={pages.fields}
        toFill={toFill}
        everybody={pages.done}
        total={hrTotal}
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

  const complete = state.complete ?? null;
  const empty = (
    <EmptyState icon={<icons.missing />} title={NOTHING.title} description={NOTHING.body} />
  );
  const laneEmpty =
    lane === 'hr'
      ? {
          title: t('completeness.completeness-grid.nothing_for_you', 'Nothing for you to fill in'),
          body: t(
            'completeness.completeness-grid.nothing_for_you_body',
            'Every field HR fills in has a value. Gaps people fill in themselves are under Waiting on employees.',
          ),
        }
      : {
          title: t('completeness.completeness-grid.nobody_waiting', 'Nobody to chase'),
          body: t(
            'completeness.completeness-grid.nobody_waiting_body',
            'Everybody has filled in what they were asked for.',
          ),
        };
  const noMatch = {
    title: t('completeness.completeness-grid.no_match', 'Nobody matches'),
    body: t(
      'completeness.completeness-grid.no_match_body',
      'Nobody loaded so far matches the search or the filters. Clear them to see everybody.',
    ),
  };
  const laneCount = (n: number | undefined, listedHere: number): string =>
    (n ?? listedHere).toLocaleString(locale());

  return (
    <Stack gap={4} className="mx-auto w-full max-w-3xl">
      {/* One figure, not four: how complete the records are, and what blocks payroll. */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        {complete === null ? null : (
          <div className="flex min-w-56 flex-1 items-center gap-3">
            <Progress
              value={complete.percent}
              label={t('completeness.completeness-grid.records_complete', 'Records complete')}
              className="max-w-80 flex-1"
            />
            <span className="text-sm whitespace-nowrap text-fg-muted tabular-nums">
              {t('completeness.completeness-grid.percent_complete', '{{percent}}% complete', {
                percent: String(complete.percent),
              })}
            </span>
          </div>
        )}
        {state.blocking === null || state.blocking === 0 ? null : (
          <Badge tone="warning" dot>
            {t(
              'completeness.completeness-grid.blocking_payroll_count',
              { one: '{{count}} blocks payroll', other: '{{count}} block payroll' },
              { count: state.blocking },
            )}
          </Badge>
        )}
      </div>

      {notices}

      {rows.length === 0 ? (
        <Card padded>{empty}</Card>
      ) : (
        <>
          {/* Whose gaps, and the one thing that does them all, on one line. */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SegmentedControl
              aria-label={t('completeness.completeness-grid.who_fills_it_in', 'Who fills it in')}
              value={lane}
              onValueChange={(next) => {
                if (next !== '') setLane(next);
              }}
            >
              <SegmentedControlItem value="hr">
                {t('completeness.completeness-grid.for_you', 'For you to fill in')}{' '}
                <span className="opacity-60 tabular-nums">{laneCount(hrTotal, hrRows.length)}</span>
              </SegmentedControlItem>
              <SegmentedControlItem value="employees">
                {t('completeness.completeness-grid.waiting_on_employees', 'Waiting on employees')}{' '}
                <span className="opacity-60 tabular-nums">
                  {laneCount(employeeTotal, employeeRows.length)}
                </span>
              </SegmentedControlItem>
            </SegmentedControl>
            {lane === 'hr' && hrRows.length > 0 ? (
              <Button
                variant="primary"
                startIcon={<icons.edit aria-hidden />}
                onClick={() => {
                  setOutcome(null);
                  setFill(FILL_ALL);
                }}
              >
                {t('completeness.completeness-grid.fill_in_for_all', 'Fill in for all')}
              </Button>
            ) : lane === 'employees' && canRemindAll ? (
              <Button
                startIcon={<icons.notifications aria-hidden />}
                loading={reminding}
                loadingLabel={t('completeness.completeness-grid.sending', 'Sending')}
                onClick={() => {
                  void remindAll();
                }}
              >
                {t(
                  'completeness.completeness-grid.remind_waiting',
                  'Remind {{peopleCount}} waiting',
                  { peopleCount: peopleCount(due) },
                )}
              </Button>
            ) : null}
          </div>
          <p className="-mt-1 text-sm text-fg-muted">
            {lane === 'hr'
              ? t(
                  'completeness.completeness-grid.lane_hr_hint',
                  'Only HR can fill these in. Fill in one person, or everybody at once in a grid.',
                )
              : state.waiting.lastReminded === null
                ? t(
                    'completeness.completeness-grid.lane_employees_hint',
                    'Each person fills in their own. They are reminded by email once a week.',
                  )
                : t(
                    'completeness.completeness-grid.lane_employees_hint_last',
                    'Each person fills in their own. Reminded by email once a week, last {{shortDay}}.',
                    { shortDay: shortDay(state.waiting.lastReminded) },
                  )}
          </p>

          <Toolbar
            search={
              <SearchField
                aria-label={t('completeness.completeness-grid.find_a_person', 'Find a person')}
                placeholder={t('completeness.completeness-grid.find_a_person', 'Find a person')}
                value={query}
                onValueChange={type}
              />
            }
            filters={
              <>
                <Select
                  value={team === null ? ANY : team === '' ? NO_TEAM : team}
                  onValueChange={(v) => {
                    setTeam(v === ANY ? null : v === NO_TEAM ? '' : v);
                  }}
                >
                  <SelectTrigger
                    size="sm"
                    className="w-auto min-w-36"
                    aria-label={t('completeness.completeness-grid.team', 'Team')}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ANY}>
                      {t('completeness.completeness-grid.every_team', 'Every team')}
                    </SelectItem>
                    {teams.map((name) => (
                      <SelectItem
                        key={name === '' ? NO_TEAM : name}
                        value={name === '' ? NO_TEAM : name}
                      >
                        {name === ''
                          ? t('completeness.completeness-grid.no_team', 'No team')
                          : name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={field ?? ANY}
                  onValueChange={(v) => {
                    setField(v === ANY ? null : v);
                  }}
                >
                  <SelectTrigger
                    size="sm"
                    className="w-auto min-w-36"
                    aria-label={t('completeness.completeness-grid.missing_field', 'Missing field')}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ANY}>
                      {t('completeness.completeness-grid.any_field', 'Any missing field')}
                    </SelectItem>
                    {fieldsMissing.map((key) => (
                      <SelectItem key={key} value={key}>
                        {labelOf(key)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={group}
                  onValueChange={(v) => {
                    setGroup(v === 'none' ? null : v);
                  }}
                >
                  <SelectTrigger
                    size="sm"
                    className="w-auto min-w-36"
                    aria-label={t('completeness.completeness-grid.group_by', 'Group by')}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {GROUPS.map((g) => (
                      <SelectItem key={g} value={g}>
                        {GROUP_LABEL[g]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {narrowed ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setTeam(null);
                      setField(null);
                      type('');
                    }}
                  >
                    {t('completeness.completeness-grid.clear', 'Clear')}
                  </Button>
                ) : null}
              </>
            }
          />

          {/* A column to read, not a table to cross: the action sits beside the name. */}
          <div>
            {laneRows.length === 0 ? (
              <Card padded>
                <EmptyState
                  icon={<icons.success />}
                  title={laneEmpty.title}
                  description={laneEmpty.body}
                />
              </Card>
            ) : (
              <VirtualList
                label={t(
                  'completeness.completeness-grid.missing_information',
                  'Missing information',
                )}
                items={items}
                itemKey={entryKey}
                scroll="page"
                listItems
                estimateItemHeight={ROW}
                {...(fill !== null || pages.loadMore === undefined
                  ? {}
                  : { onEndReached: pages.loadMore })}
                loadingMore={pages.loading}
                {...(laneTotal === undefined ? {} : { total: laneTotal })}
                // People, not entries: a heading is not one, and by field a person is under each gap.
                loaded={shown.length}
                empty={
                  <EmptyState
                    icon={<icons.search />}
                    title={noMatch.title}
                    description={noMatch.body}
                  />
                }
                renderItem={listRow}
              />
            )}
          </div>
        </>
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

/* ------------------------------------------------- the list's entries -- */

type Lane = 'hr' | 'employees';
const GROUPS = ['none', 'team', 'manager', 'field'] as const;
type GroupBy = (typeof GROUPS)[number];
const GROUP_LABEL: Readonly<Record<GroupBy, string>> = {
  get none(): string {
    return t('completeness.completeness-grid.no_grouping', 'No grouping');
  },
  get team(): string {
    return t('completeness.completeness-grid.by_team', 'By team');
  },
  get manager(): string {
    return t('completeness.completeness-grid.by_manager', 'By manager');
  },
  get field(): string {
    return t('completeness.completeness-grid.by_missing_field', 'By missing field');
  },
};
/** A Select's value for "no filter", and for people with no team: Radix gives an empty string no item. */
const ANY = 'any';
const NO_TEAM = 'none';

/** A row of the list: a person, or the heading of a group of them. */
type Entry =
  | { readonly kind: 'row'; readonly key: string; readonly row: GapRow }
  | { readonly kind: 'head'; readonly key: string; readonly label: string; readonly count: number };
const entryKey = (e: Entry): string => e.key;

/**
 * The rows as the list draws them, grouped under headings when asked. By
 * missing field, a person is under every field they lack: the group is the
 * work ("Bank details · 24 people"), largest first. Teams and managers in
 * alphabetical order, the people without one last.
 */
export function grouped(
  rows: readonly GapRow[],
  by: GroupBy,
  labelOf: (key: string) => string,
): Entry[] {
  const person = (r: GapRow, under = ''): Entry => ({
    kind: 'row',
    key: `${under}${rowId(r)}`,
    row: r,
  });
  if (by === 'none') return rows.map((r) => person(r));
  const groups = new Map<string, GapRow[]>();
  for (const r of rows) {
    const keys = by === 'field' ? r.missing : [(by === 'team' ? r.department : r.manager) ?? ''];
    for (const k of keys) groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const none =
    by === 'team'
      ? t('completeness.completeness-grid.no_team', 'No team')
      : t('completeness.completeness-grid.no_manager', 'No manager');
  const ordered = [...groups].sort(([a, ra], [b, rb]) =>
    by === 'field'
      ? rb.length - ra.length || labelOf(a).localeCompare(labelOf(b))
      : a === ''
        ? 1
        : b === ''
          ? -1
          : a.localeCompare(b),
  );
  return ordered.flatMap(([k, members]) => [
    {
      kind: 'head' as const,
      key: `head:${k}`,
      label: by === 'field' ? labelOf(k) : k === '' ? none : k,
      count: members.length,
    },
    ...members.map((r) => person(r, `${k}:`)),
  ]);
}

/** "Missing: Bank details, Tax ID, Address +2": three named, the rest counted. */
function missingText(labels: readonly string[]): string {
  const shown = labels.slice(0, 3).join(', ');
  return labels.length > 3
    ? t('completeness.completeness-grid.missing_more', 'Missing: {{shown}} +{{count}}', {
        shown,
        count: String(labels.length - 3),
      })
    : t('completeness.completeness-grid.missing', 'Missing: {{join}}', { join: shown });
}

/** A row's height, for the list to place rows it has not measured yet. */
const ROW = 56;

const NOTHING = {
  get title(): string {
    return t('completeness.completeness-grid.nothing_is_missing', 'Nothing is missing');
  },
  get body(): string {
    return t(
      'completeness.completeness-grid.every_required_field_has_a_value',
      'Every required field has a value for everybody it applies to.',
    );
  },
};

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
  const details = t(
    'completeness.completeness-grid.text',
    { one: '{{count}} detail', other: '{{count}} details' },
    { count: shown.length },
  );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-140">
        <DialogHeader>
          <DialogTitle>
            {t('completeness.completeness-grid.fill_in_for', 'Fill in for {{name}}', {
              name: row.name,
            })}
          </DialogTitle>
          <DialogDescription>
            {t(
              'completeness.completeness-grid.hr_keeps_nothing_is_saved_until',
              '{{details}} HR keeps. Nothing is saved until you press Save.',
              { details },
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <SectionForm
            section={{
              key: 'missing',
              label: t(
                'completeness.completeness-grid.missing_details_for',
                'Missing details for {{name}}',
                { name: row.name },
              ),
              visibility: [],
              fields: shown,
            }}
            values={{}}
            hint={t(
              'completeness.completeness-grid.sensitive_values_wait_for_approval',
              'Sensitive values wait for approval.',
            )}
            footer={
              <DialogClose asChild>
                <Button variant="ghost">
                  {t('completeness.completeness-grid.cancel', 'Cancel')}
                </Button>
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
  total,
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
  /** The people HR fills in for over everybody; absent from an older People. */
  readonly total: number | undefined;
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
  // Named by key, so a page that lands with the same fields keeps the columns,
  // and no row drawn is drawn again for it.
  const shownKeys = useMemo(
    () =>
      [...asRecord.keys()].filter((key) => rows.some((r) => r.missing.includes(key))).join('\n'),
    [asRecord, rows],
  );
  const shown = useMemo(
    () =>
      shownKeys === ''
        ? []
        : shownKeys.split('\n').flatMap((key) => {
            const one = asRecord.get(key);
            return one === undefined ? [] : [one];
          }),
    [asRecord, shownKeys],
  );
  const columns = useMemo(
    (): DataColumn<GapRow>[] => [
      {
        id: 'person',
        header: t('completeness.completeness-grid.person', 'Person'),
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
                {t('completeness.completeness-grid.sensitive', 'Sensitive')}
              </Badge>
            </span>
          ) : (
            field.label
          ),
        cell: (r) =>
          r.missing.includes(field.key) ? (
            <Cell edits={edits} row={r} field={field} />
          ) : (
            <span
              className="text-fg-subtle"
              aria-label={t(
                'completeness.completeness-grid.already_filled_in',
                'Already filled in',
              )}
            >
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
          <h2 className="font-display text-xl font-bold tracking-tight">
            {t('completeness.completeness-grid.fill_in_for_hr', 'Fill in for HR')}
          </h2>
          <p className="text-sm text-fg-muted">
            {t(
              'completeness.completeness-grid.tab_moves_across_moves_down_nothing',
              {
                one: '{{count}} detail{{value2}}. Tab moves across, ↵ moves down. Nothing is saved until you press Save.',
                other:
                  '{{count}} details{{value2}}. Tab moves across, ↵ moves down. Nothing is saved until you press Save.',
              },
              {
                count: toFill,
                value2: everybody
                  ? ' ' +
                    t('completeness.completeness-grid.across', 'across {{peopleCount}}', {
                      peopleCount: peopleCount(people),
                    })
                  : '',
              },
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" startIcon={<icons.back aria-hidden />} onClick={onBack}>
            {t('completeness.completeness-grid.back_to_the_list', 'Back to the list')}
          </Button>
          <Button
            variant="primary"
            disabled={pending === 0}
            loading={saving}
            loadingLabel={t('completeness.completeness-grid.saving', 'Saving')}
            shortcut="form.submit"
            onClick={() => {
              void save();
            }}
          >
            {doubted.length > 0
              ? t('completeness.completeness-grid.save_anyway', 'Save anyway')
              : pending === 0
                ? t('completeness.completeness-grid.save', 'Save')
                : t(
                    'completeness.completeness-grid.save_2',
                    { one: 'Save {{count}} change', other: 'Save {{count}} changes' },
                    { count: pending },
                  )}
          </Button>
        </div>
      </div>
      {notices}
      {doubted.length === 0 ? null : (
        <Alert
          tone="warning"
          title={t(
            'completeness.completeness-grid.our_checks_suggest_some_of_these',
            'Our checks suggest some of these may be wrong',
          )}
        >
          {t(
            'completeness.completeness-grid.check_the_marked_cells_if_theyre',
            'Check the marked cells. If they’re correct, save anyway and HR will review them.',
          )}
        </Alert>
      )}
      {rows.length === 0 ? (
        <Card padded>
          <EmptyState
            icon={<icons.missing />}
            title={t(
              'completeness.completeness-grid.nothing_for_hr_to_fill_in',
              'Nothing for HR to fill in',
            )}
            description={t(
              'completeness.completeness-grid.every_gap_left_is_a_persons',
              'Every gap left is a person’s own: remind them from the list.',
            )}
          />
        </Card>
      ) : (
        // ↵ is caught here, once, for every line in the grid.
        <div onKeyDown={down} className="contents">
          <DataTable
            ref={table}
            label={t('completeness.completeness-grid.missing_values', 'Missing values')}
            rows={rows}
            columns={columns}
            rowId={personOf}
            fill
            {...(loadMore === undefined ? {} : { onEndReached: loadMore })}
            loadingMore={loading}
            {...(total === undefined ? {} : { total })}
            virtualize
          />
        </div>
      )}
      <p className="text-sm text-fg-muted">
        {t(
          'completeness.completeness-grid.each_persons_edits_go_out_as',
          'Each person’s edits go out as one change. Sensitive values wait for approval; doubted identifiers go to HR’s review.',
        )}
      </p>
    </Stack>
  );
}

const cellId = (personId: string, key: string): string => `cell-${personId}-${key}`;
const personOf = (r: GapRow): string => r.personId;

/**
 * Kinds whose control is heavy to draw (a list, a calendar, a person search):
 * an empty one is a plain cell until it is pressed or reached by Tab.
 */
const PICKERS = new Set<RecordField['dataType']>([
  'select',
  'multi_select',
  'tags',
  'date',
  'person_ref',
  'country',
  'currency',
  'language',
  'time_zone',
  'org_unit_ref',
  'legal_entity_ref',
  'location_ref',
  // Inputs with a dial-code list or a currency beside them: heavier than a line.
  'phone',
  'money',
]);

/** Pickers whose choices are not a list sent with the field. */
const UNLISTED = new Set<RecordField['dataType']>(['date', 'person_ref', 'tags', 'phone', 'money']);

/**
 * One empty cell: the control its field's type takes, reading and writing
 * its own value in the grid's edits, so typing here re-renders this cell
 * alone.
 *
 * A picker is drawn as a plain cell until it is used: a page of people times
 * a dozen fields of lists and calendars cost the grid a third of a second to
 * open. Pressed, the control replaces it already open; reached by Tab, it
 * replaces it with the focus in it. Synchronous, in the same event, so the
 * press is answered on the next frame.
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
  const [live, setLive] = useState<'focus' | 'open' | null>(null);
  const at = useRef<HTMLDivElement>(null);
  const id = cellId(row.personId, field.key);
  const label = t('completeness.completeness-grid.for', '{{label}} for {{name}}', {
    label: field.label,
    name: row.name,
  });
  // The control that replaced the plain cell takes the focus it had.
  useLayoutEffect(() => {
    if (live === null) return;
    at.current?.querySelector<HTMLElement>('button, input')?.focus({ preventScroll: true });
  }, [live]);
  // A list with nothing in it is drawn as it is, disabled, saying so.
  const empty = field.options.length === 0 && !UNLISTED.has(field.dataType);
  const plain = live === null && value === null && PICKERS.has(field.dataType) && !empty;
  return (
    <div data-cell={field.key} data-person={row.personId} className="min-w-32" ref={at}>
      {plain ? (
        <InlineCell
          id={id}
          aria-label={label}
          aria-haspopup="listbox"
          readOnly
          value=""
          status="missing"
          // Pressed: no focus first, so the control comes in open, not twice.
          onMouseDown={(event) => {
            event.preventDefault();
          }}
          onClick={() => {
            setLive('open');
          }}
          onFocus={() => {
            setLive((was) => was ?? 'focus');
          }}
          containerClassName="min-w-32"
        />
      ) : (
        <AttributeControl
          field={field}
          value={value}
          label={label}
          cell={{ id, warning, open: live === 'open' }}
          onChange={(next) => {
            edits.set(row.personId, field.key, next);
          }}
        />
      )}
    </div>
  );
});

/* ------------------------------------------------------------- words -- */

const DAY_MS = 24 * 60 * 60 * 1000;

/** "21 Sep": when, to the day. */
const shortDay = (iso: string): string =>
  new Date(iso).toLocaleDateString(locale(), { day: 'numeric', month: 'short', timeZone: 'UTC' });
/** "12 people", "1 person". */
const peopleCount = (count: number): string =>
  t(
    'completeness.completeness-grid.count_people',
    { one: '{{count}} person', other: '{{count}} people' },
    { count: count },
  );

/** What "Remind N people" did, in words: who was sent one, and who was not and why. */
function remindedText(r: Extract<RemindOutcome, { ok: true }>): string {
  return [
    r.sent === 0
      ? t('completeness.completeness-grid.nobody_was_due_a_reminder', 'Nobody was due a reminder.')
      : t('completeness.completeness-grid.sent', 'Sent {{n}}.', {
          n: t(
            'completeness.completeness-grid.count_reminders',
            { one: '{{count}} reminder', other: '{{count}} reminders' },
            { count: r.sent },
          ),
        }),
    r.failed === 0
      ? ''
      : t('completeness.completeness-grid.could_not_be_sent', '{{n}} could not be sent.', {
          n: t(
            'completeness.completeness-grid.count_emails',
            { one: '{{count}} email', other: '{{count}} emails' },
            { count: r.failed },
          ),
        }),
    r.skipped === 0
      ? ''
      : t(
          'completeness.completeness-grid.not_due_reminded_in_the_last',
          '{{n}} not due: reminded in the last week, outside their working hours, or with no work email.',
          {
            n: t(
              'completeness.completeness-grid.count_people_were',
              { one: '{{count}} person was', other: '{{count}} people were' },
              { count: r.skipped },
            ),
          },
        ),
  ]
    .filter((line) => line !== '')
    .join(' ');
}
