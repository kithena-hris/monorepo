import {
  Avatar,
  Badge,
  Button,
  Card,
  Chip,
  ChipGroup,
  ChipGroupItem,
  ChipRow,
  ColumnChooser,
  DataTable,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  FilterBuilder,
  Kbd,
  KbdShortcut,
  KeyValues,
  List,
  ListItem,
  PageHeader,
  PersonCard,
  Popover,
  PopoverContent,
  PopoverTrigger,
  QuickLook,
  ScrollPosition,
  SearchField,
  SegmentedControl,
  SegmentedControlItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Stack,
  Toolbar,
  icons,
  isConditionComplete,
  keysOf,
  pressed,
  useCoarsePointer,
  useInView,
  useShortcutKeys,
  type ColumnChooserValue,
  type DataColumn,
  type DataTableHandle,
  type DataTableSort,
  type FilterField,
  type FilterGroup,
  type FilterOperator,
} from '@reach/ui';
import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type JSX,
  type ReactNode,
} from 'react';

import { useTyped } from '../held';
import { ImportBusy, isRunning, type ImportRunStatus } from '../import/import-run';
import { Loaded, type Loadable, type Outcome } from '../load';
import { longDate } from '../record/display';
import { MissingMark } from '../record/missing';
import { SaveSegment, type SegmentRef } from '../segments';
import {
  AskBar,
  NeedsYou,
  Understood,
  cacheAnswer,
  cachedAnswer,
  rememberReading,
  rememberedReadings,
  useRecent,
  type AskedReading,
  type AskedRefusal,
  type UnderstoodChip,
} from './smart-search';

/** A column, generated from the published schema: only what this viewer may read. */
export interface DirectoryColumn {
  readonly key: string;
  readonly label: string;
  /** Shown until the viewer chooses otherwise. Absent: shown. */
  readonly shown?: boolean;
  /** People can order the directory by it. */
  readonly sortable?: boolean;
}

/** A field the viewer may build a condition on, and what kind of value it holds. */
export interface DirectoryField {
  readonly key: string;
  readonly label: string;
  /** text, select, date, number, person or status: which operators fit. */
  readonly kind: string;
  readonly options: readonly { readonly value: string; readonly label: string }[];
}

export interface DirectoryCondition {
  readonly key: string;
  readonly op: string;
  readonly values: readonly string[];
}

export interface DirectorySort {
  readonly key: string;
  readonly direction: 'asc' | 'desc';
}

/**
 * Something People works out about each person that the directory may be
 * ordered by — missing details, tenure, direct reports — with the order in
 * words both ways. One that is `filter` is in `fields` too.
 */
export interface DirectoryMetric {
  readonly key: string;
  readonly label: string;
  readonly kind: string;
  readonly filter: boolean;
  /** Descending, in words: "most missing details". */
  readonly most: string;
  /** Ascending: "fewest missing details". */
  readonly least: string;
}

export interface DirectoryPerson {
  readonly id: string;
  readonly name: string;
  readonly email: string | null;
  readonly avatarUrl: string | null;
  /** Display text per column key. A key the viewer cannot read is absent. */
  readonly values: Readonly<Record<string, string>>;
  /** Each person column (a manager): who, to draw as a person with their photo. */
  readonly people?: readonly {
    readonly key: string;
    readonly id: string;
    readonly name: string;
    readonly avatarUrl: string | null;
  }[];
  /** Missing required values, or null when this viewer is not shown completeness. */
  readonly missing: number | null;
}

/** A field the viewer may filter on: one they can read on everybody. */
export interface DirectoryFilter {
  readonly key: string;
  readonly label: string;
  readonly options: readonly { readonly value: string; readonly label: string }[];
}

export interface DirectoryState {
  /** Everybody the search and filters match, not only this page. */
  readonly total: number;
  readonly active: number;
  /** Provisional or pre-hire; null for a viewer who is not shown statuses. */
  readonly notStarted: number | null;
  readonly incomplete: number | null;
  readonly columns: readonly DirectoryColumn[];
  /** Everything a condition may name. Absent: no advanced filters. */
  readonly fields?: readonly DirectoryField[];
  /** What People works out that this viewer may order by (`?sort=missing_count:desc`). */
  readonly metrics?: readonly DirectoryMetric[];
  /** The conditions and order this page answers. */
  readonly query?: {
    readonly conditions: readonly DirectoryCondition[];
    /** all or any. */
    readonly match: string;
    readonly sort: DirectorySort | null;
    /** At most this many people (`?top=5`); null or absent for everybody found. */
    readonly top?: number | null;
  };
  readonly filterable: readonly DirectoryFilter[];
  readonly people: readonly DirectoryPerson[];
  /** The saved segments this viewer could apply here (PEO-068). */
  readonly segments?: readonly SegmentRef[];
  /** Smart search's "Try asking": questions from the company's own fields. */
  readonly suggestions?: readonly string[];
  /** The details the conditions find empty that this viewer may ask people for; null for none. */
  readonly remind?: readonly string[] | null;
}

export interface DirectoryProps {
  readonly load: Loadable<DirectoryState>;
  /** The search People answered, `?q=`. */
  readonly search: string;
  /** A new search, once typing rests. */
  readonly onSearchChange: (search: string) => void;
  /** Applied by the shell, server-side: `?filter=key:value`. */
  readonly filters: Readonly<Record<string, string>>;
  readonly onFiltersChange: (filters: Readonly<Record<string, string>>) => void;
  /** Conditions, all or any of them, applied server-side: `?conditions=`. */
  readonly onConditionsChange?: (
    conditions: readonly DirectoryCondition[],
    match: 'all' | 'any',
  ) => void;
  /** The order, applied server-side: `?sort=key:asc`. Null is People's own order. */
  readonly onSortChange?: (sort: DirectorySort | null) => void;
  /** The column people are grouped by, `?group=key`; the shell orders by it too. */
  readonly group?: string | null;
  readonly onGroupChange?: (key: string | null) => void;
  /** The saved segment applied, server-side: `?segment=<id>`. */
  readonly segmentId?: string | null;
  readonly onSegmentChange?: (segmentId: string | null) => void;
  /**
   * A view from the row across the top: its conditions, whether only the
   * incomplete, and a saved segment, with everything else cleared.
   */
  readonly onView?: (view: {
    readonly conditions: readonly DirectoryCondition[];
    readonly incomplete: boolean;
    readonly segmentId: string | null;
  }) => void;
  /** Which view this is: the route says, not the screen (`/people/directory/cards`). */
  readonly view?: 'list' | 'cards';
  /** Another view of the same people, search and filters kept. Without it, no switch. */
  readonly onViewChange?: (view: DirectoryView) => void;
  /** Save the filters in force as a segment. */
  readonly onSaveSegment?: (segment: { name: string; shared: boolean }) => Promise<Outcome>;
  readonly onOpen: (personId: string) => void;
  /**
   * Present only when the viewer may do each. Adding one employee is not
   * here: it is People's manifest action, which the host draws beside every
   * People screen, so a screen never repeats it.
   */
  readonly onExport?: () => void;
  readonly onImport?: () => void;
  /** The company's import running now: Import waits for it, saying why. */
  readonly running?: ImportRunStatus | null;
  /** HR's: edit the people chosen on this page together (PEO-071). Rows are selectable only with it. */
  readonly onBulkEdit?: (personIds: readonly string[]) => void;
  /**
   * The page after `after`, for infinite scroll: appended as the reader nears
   * the end. With it, the table scrolls and there is no pager.
   */
  readonly onLoadMore?: (
    after: string,
  ) => Promise<{ readonly people: readonly unknown[]; readonly next: string | null } | null>;
  /** The cursor for the page after the first. */
  readonly next?: string | null;
  /** Present when People has a page after this one. */
  readonly onNextPage?: () => void;
  /** Present when this is not the first page. */
  readonly onFirstPage?: () => void;
  /** Only people with a required detail missing: HR's, server-side (`?incomplete=true`). */
  readonly incomplete?: boolean;
  readonly onIncompleteChange?: (incomplete: boolean) => void;
  /**
   * Smart search (docs/ai-settings.md): what was typed, on Enter, with the
   * readings this viewer chose before. The host goes to the one person a
   * name or an email finds, or puts the filters it became in the address.
   * An empty sentence clears the question and its filters. Absent: the
   * field searches names only, as they are typed.
   */
  readonly onAsk?: (
    sentence: string,
    remembered: Readonly<Record<string, string>>,
  ) => Promise<DirectoryAsked>;
  /** The question the filters in force came from, `?ask=`; null for none. */
  readonly asked?: string | null;
  /** "Remind all": everybody the conditions find is asked for what they find empty. */
  readonly onRemind?: (
    conditions: readonly DirectoryCondition[],
    match: 'all' | 'any',
  ) => Promise<
    | { readonly ok: true; readonly asked: number; readonly more: boolean }
    | { readonly ok: false; readonly message: string }
  >;
  /** The row the reader had scrolled to, `?row=` (1 is the first); null for the top. */
  readonly place?: number | null;
  /** Where the reader is now, noted in the address so Back returns to the same row. */
  readonly onPlaceChange?: (row: number | null) => void;
}

/** What People made of a sentence typed in the search, once the host has applied it. */
export type DirectoryAsked =
  | {
      readonly ok: true;
      /** A name search, the one person it found, the assistant, or People's own rules. */
      readonly by: 'search' | 'person' | 'assistant' | 'rules';
      /** Why the assistant did not read it, when it did not. */
      readonly note: string | null;
      /** What was read and how, where the chips do not say it: a manager not found, a grouping. */
      readonly notes?: readonly string[];
      /** Words nothing was made of. */
      readonly unused: readonly string[];
      /** How many conditions and orders it became; none, and names were searched for it. */
      readonly filters: number;
      /** A name it held, searched beside the filters; null for none. */
      readonly search: string | null;
      /** A phrase read more than one way, asked rather than guessed. */
      readonly ask?: {
        readonly topic: string | null;
        readonly phrase: string;
        readonly readings: readonly AskedReading[];
      } | null;
      /** Judgements left out, and why. */
      readonly refused?: readonly AskedRefusal[];
      /** A reading taken because this viewer chose it before. */
      readonly remembered?: {
        readonly topic: string;
        readonly phrase: string;
        readonly label: string;
      } | null;
    }
  | { readonly ok: false; readonly message: string };

const ANY = '__any';
const PERSON = 'person';
const COLUMNS_KEY = 'people.directory.columns';
const WIDTHS_KEY = 'people.directory.widths';

/** Column widths, remembered in this browser like the choice of columns. */
function useWidths() {
  const [widths, setWidths] = useState<Readonly<Record<string, number>>>({});
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(WIDTHS_KEY);
      if (saved !== null) setWidths(JSON.parse(saved) as Record<string, number>);
    } catch {
      // No storage: the defaults stand.
    }
  }, []);
  const choose = (next: Readonly<Record<string, number>>) => {
    setWidths(next);
    try {
      window.localStorage.setItem(WIDTHS_KEY, JSON.stringify(next));
    } catch {
      // Remembered for this page only.
    }
  };
  return { widths, choose };
}

/**
 * The rows: the first page as the shell drew it, then each page after it,
 * a page ahead of the reader. The second is asked for as soon as the first is
 * drawn, and each after it once the reader is halfway through what is loaded
 * (`usePlace`), so the end of the list is never where they wait. A cursor is
 * asked for once, however many triggers fire together. A new query is a new
 * first page, and starts again.
 */
function useRows(
  first: readonly DirectoryPerson[],
  next: string | null,
  onLoadMore: DirectoryProps['onLoadMore'],
) {
  const [more, setMore] = useState<{ people: DirectoryPerson[]; next: string | null }>({
    people: [],
    next,
  });
  const [loading, setLoading] = useState(false);
  // How many the last page added, for the live region: "50 more loaded".
  const [added, setAdded] = useState<number | null>(null);
  // Reset while rendering, not after: an effect would leave one render, and a
  // prefetch, holding the old query's cursor.
  const [query, setQuery] = useState({ first, next });
  if (query.first !== first || query.next !== next) {
    setQuery({ first, next });
    setMore({ people: [], next });
    setAdded(null);
  }
  // The cursors asked for, for this first page: each is fetched once.
  const asked = useRef<{ first: readonly DirectoryPerson[]; cursors: Set<string> }>({
    first,
    cursors: new Set(),
  });
  const loadMore =
    onLoadMore === undefined || more.next === null
      ? undefined
      : () => {
          const after = more.next;
          if (asked.current.first !== first) asked.current = { first, cursors: new Set() };
          if (after === null || asked.current.cursors.has(after)) return;
          asked.current.cursors.add(after);
          setLoading(true);
          void onLoadMore(after).then((page) => {
            setLoading(false);
            // Nothing came: the next trigger may ask again.
            if (page === null) {
              asked.current.cursors.delete(after);
              return;
            }
            setAdded(page.people.length);
            setMore((m) =>
              m.next !== after
                ? m
                : { people: [...m.people, ...(page.people as DirectoryPerson[])], next: page.next },
            );
          });
        };
  // The page after the first, as soon as the first is drawn.
  const ahead = useRef(loadMore);
  ahead.current = loadMore;
  useEffect(() => {
    ahead.current?.();
  }, [first]);
  return { rows: [...first, ...more.people], loading, loadMore, added, done: more.next === null };
}

/**
 * The next page as the reader nears the end of a list or of cards, which
 * scroll with the page rather than in a box of their own as the table does:
 * a sentinel a screen ahead (`useInView`), asked again each time a page lands
 * while it is still in view. Keyboard users reach it too: focus moving to
 * the last person scrolls it into view.
 */
function useEndOfPage(on: boolean, loading: boolean, loadMore: (() => void) | undefined) {
  const [ref, near] = useInView<HTMLDivElement>({ rootMargin: '400px', enabled: on && !loading });
  const load = useRef(loadMore);
  load.current = loadMore;
  useEffect(() => {
    if (on && near && !loading) load.current?.();
  }, [on, near, loading]);
  return ref;
}

/**
 * "12 people · 9 active · 3 not started · 4 incomplete": everybody matched,
 * then what HR is shown of their statuses. Somebody on leave or on notice is
 * among the people and in neither count. Without statuses, only how many.
 */
export function summaryOf(state: DirectoryState): string {
  const { total, notStarted, incomplete } = state;
  return [
    `${String(total)} ${total === 1 ? 'person' : 'people'}`,
    notStarted === null ? null : `${String(state.active)} active`,
    notStarted === null || notStarted === 0 ? null : `${String(notStarted)} not started`,
    incomplete === null ? null : `${String(incomplete)} incomplete`,
  ]
    .filter((x) => x !== null)
    .join(' · ');
}

/** The operators People honours for each kind of field, in the order offered. */
const EMPTY: FilterOperator[] = [
  { id: 'empty', label: 'is empty', value: 'none' },
  { id: 'not_empty', label: 'is not empty', value: 'none' },
];
const OPERATORS: Record<string, readonly FilterOperator[]> = {
  text: [
    { id: 'contains', label: 'contains', value: 'text' },
    { id: 'is', label: 'is exactly', value: 'text' },
    ...EMPTY,
  ],
  select: [
    { id: 'in', label: 'is any of', value: 'options' },
    { id: 'not_in', label: 'is none of', value: 'options' },
    ...EMPTY,
  ],
  status: [
    { id: 'in', label: 'is any of', value: 'options' },
    { id: 'not_in', label: 'is none of', value: 'options' },
  ],
  date: [
    { id: 'between', label: 'is between', value: 'date-range' },
    { id: 'before', label: 'is before', value: 'date' },
    { id: 'after', label: 'is after', value: 'date' },
    ...EMPTY,
  ],
  number: [
    { id: 'is', label: 'is', value: 'number' },
    { id: 'before', label: 'is less than', value: 'number' },
    { id: 'after', label: 'is more than', value: 'number' },
    ...EMPTY,
  ],
  person: EMPTY,
};

export function filterFields(fields: readonly DirectoryField[]): FilterField[] {
  return fields.map((f) => ({
    id: f.key,
    label: f.label,
    operators: OPERATORS[f.kind] ?? OPERATORS['text'] ?? [],
    options: f.options,
  }));
}

/** "Department is any of Sales, Accounting": a condition as somebody reads it back. */
export function describeCondition(
  fields: readonly DirectoryField[],
  condition: DirectoryCondition,
): string {
  const field = fields.find((f) => f.key === condition.key);
  const label = field?.label ?? condition.key;
  const op =
    (OPERATORS[field?.kind ?? 'text'] ?? []).find((o) => o.id === condition.op)?.label ??
    condition.op;
  const shown = (v: string) =>
    field?.options.find((o) => o.value === v)?.label ??
    (field?.kind === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? longDate(v) : v);
  if (condition.op === 'empty' || condition.op === 'not_empty') return `${label} ${op}`;
  if (condition.op === 'between') {
    const [from = '', to = ''] = condition.values;
    if (from === '') return `${label} is on or before ${shown(to)}`;
    if (to === '') return `${label} is on or after ${shown(from)}`;
    return `${label} is between ${shown(from)} and ${shown(to)}`;
  }
  return `${label} ${op} ${condition.values.map(shown).join(', ')}`;
}

/**
 * The directory (W3–W5, M2–M3).
 *
 * Columns come from the published schema rather than from this file, so a
 * field a tenant invented on Tuesday is a column and a filter by Wednesday.
 * Search, conditions, order and paging run where the rows are — the shell
 * passes them to People, a page of people at a time (PEO-117) — because
 * 50,000 rows do not travel to a browser to be searched.
 *
 * Over the list, the views (everybody, who is starting, who is leaving, whose
 * record is incomplete, each saved view), then the search with the filters in
 * force as chips, and the way to switch between a table, cards and the org
 * chart. A row opens a quick look beside the table (W3b) so a reader checks
 * somebody without losing their place: ↑ and ↓ move to the next person, ↵
 * opens the full profile. Under a finger the table is a list of people, each
 * row a tap to their profile.
 */
export function Directory(props: DirectoryProps): JSX.Element {
  const { load, view = 'list', onViewChange } = props;
  const summary = load.status === 'ready' ? summaryOf(load.data) : undefined;

  return (
    <Stack gap={5}>
      <PageHeader
        title="Directory"
        description={summary}
        actions={
          onViewChange === undefined ? undefined : (
            <ViewSwitch view={view} onChange={onViewChange} />
          )
        }
      />
      {onViewChange === undefined ? null : <ViewSwitch phone view={view} onChange={onViewChange} />}
      <Loaded load={load} what="the directory">
        {(state) => <Body {...props} state={state} />}
      </Loaded>
    </Stack>
  );
}

const STATUS_TONE: Record<string, 'success' | 'neutral' | 'warning' | 'info'> = {
  Active: 'success',
  'On leave': 'info',
  'On notice': 'warning',
  'Starting soon': 'info',
};

/** The three ways of seeing the same people (V2, V3), each a route of its own. */
export type DirectoryView = 'list' | 'cards' | 'org-chart';

/**
 * List, Cards or Org chart, labelled, in the header's actions (V2). Under a
 * finger (MV3, MV4) a full-width List / Org chart at the top of the page:
 * a phone shows people as a list whichever of the first two was chosen.
 */
export function ViewSwitch({
  view,
  onChange,
  phone = false,
}: {
  readonly view: DirectoryView;
  readonly onChange: (view: DirectoryView) => void;
  readonly phone?: boolean;
}): JSX.Element {
  const chosen = (next: string): void => {
    if (next === 'list' || next === 'cards' || next === 'org-chart') onChange(next);
  };
  return phone ? (
    <SegmentedControl
      aria-label="Show people as"
      fullWidth
      value={view === 'org-chart' ? 'org-chart' : 'list'}
      onValueChange={chosen}
      className="hidden touch:flex"
    >
      <SegmentedControlItem value="list">List</SegmentedControlItem>
      <SegmentedControlItem value="org-chart">Org chart</SegmentedControlItem>
    </SegmentedControl>
  ) : (
    <SegmentedControl
      aria-label="Show people as"
      size="sm"
      value={view}
      onValueChange={chosen}
      className="touch:hidden"
    >
      <SegmentedControlItem value="list">
        <icons.list aria-hidden />
        List
      </SegmentedControlItem>
      <SegmentedControlItem value="cards">
        <icons.cards aria-hidden />
        Cards
      </SegmentedControlItem>
      <SegmentedControlItem value="org-chart">
        <icons.hierarchy aria-hidden />
        Org chart
      </SegmentedControlItem>
    </SegmentedControl>
  );
}

/**
 * The views across the top: one at a time, each applied by the shell on the
 * server like any filter. A count shows where People gave one; the rest are
 * views, not totals.
 */
function Views({
  state,
  conditions,
  segmentId,
  incomplete,
  onView,
}: {
  readonly state: DirectoryState;
  readonly conditions: readonly DirectoryCondition[];
  readonly segmentId: string | null;
  readonly incomplete: boolean;
  readonly onView?: DirectoryProps['onView'];
}): JSX.Element | null {
  const statuses = (state.fields ?? []).some((f) => f.key === 'status');
  const statusIs = (value: string) =>
    conditions.length === 1 &&
    conditions[0]?.key === 'status' &&
    conditions[0].values.length === 1 &&
    conditions[0].values[0] === value;
  const everyone = conditions.length === 0 && !incomplete && segmentId === null;
  const status = (value: string) => ({
    conditions: [{ key: 'status', op: 'in', values: [value] }],
    incomplete: false,
    segmentId: null,
  });
  const views = [
    {
      id: 'everyone',
      label: 'Everyone',
      count: everyone ? state.total : null,
      on: everyone,
      view: { conditions: [], incomplete: false, segmentId: null },
    },
    ...(statuses
      ? [
          {
            id: 'starting',
            label: 'Starting soon',
            count: everyone ? state.notStarted : null,
            on: statusIs('pre_hire'),
            view: status('pre_hire'),
          },
          {
            id: 'leaving',
            label: 'Leaving',
            count: null,
            on: statusIs('notice'),
            view: status('notice'),
          },
        ]
      : []),
    ...(state.incomplete === null
      ? []
      : [
          {
            id: 'incomplete',
            label: 'Incomplete',
            count: everyone ? state.incomplete : null,
            on: incomplete,
            view: { conditions: [], incomplete: true, segmentId: null },
          },
        ]),
    ...(state.segments ?? []).map((s) => ({
      id: `segment:${s.id}`,
      label: s.name,
      count: null,
      saved: true,
      on: segmentId === s.id,
      view: { conditions: [], incomplete: false, segmentId: s.id },
    })),
  ];
  if (onView === undefined || views.length < 2) return null;
  const active = views.find((v) => v.on)?.id ?? '';
  return (
    <div className="flex min-w-0 items-center">
      <ChipGroup
        type="single"
        scroll
        aria-label="Views"
        value={active}
        onValueChange={(id) => {
          const chosen = views.find((v) => v.id === (id === '' ? 'everyone' : id));
          if (chosen !== undefined) onView(chosen.view);
        }}
        className="min-w-0 gap-1.5"
      >
        {views.map((v) => (
          <ChipGroupItem key={v.id} value={v.id} variant="view">
            {'saved' in v ? <icons.starred aria-hidden /> : null}
            {v.label}
            {v.count === null ? null : (
              <span className="font-medium tabular-nums">{v.count.toLocaleString('en-GB')}</span>
            )}
          </ChipGroupItem>
        ))}
      </ChipGroup>
    </div>
  );
}

/** The page People sends at a time, as the footer says it. */
const DIRECTORY_PAGE = 50;

type Answered = Extract<DirectoryAsked, { ok: true }>;

const peopleCount = (n: number): string =>
  `${n.toLocaleString('en-GB')} ${n === 1 ? 'person' : 'people'}`;

/** "ordered by start date, latest first", "sorted by most missing details": an order in words. */
function orderWords(
  sort: DirectorySort,
  fields: readonly DirectoryField[],
  metrics: readonly DirectoryMetric[] = [],
): string {
  if (sort.key === 'name') return `sorted by name${sort.direction === 'desc' ? ', Z to A' : ''}`;
  const metric = metrics.find((m) => m.key === sort.key);
  if (metric !== undefined) {
    return `sorted by ${sort.direction === 'desc' ? metric.most : metric.least}`;
  }
  const field = fields.find((f) => f.key === sort.key);
  const label = (field?.label ?? sort.key).toLowerCase();
  const way =
    field?.kind === 'date'
      ? sort.direction === 'desc'
        ? 'latest first'
        : 'earliest first'
      : field?.kind === 'number'
        ? sort.direction === 'desc'
          ? 'highest first'
          : 'lowest first'
        : sort.direction === 'desc'
          ? 'Z to A'
          : 'A to Z';
  return `ordered by ${label}, ${way}`;
}

/** "Most missing details": an order as a menu offers it. */
const capital = (s: string): string => `${s.charAt(0).toUpperCase()}${s.slice(1)}`;

/** A whole year, a whole month, or the range as written. */
function spanWords(from: string, to: string): string {
  if (/^\d{4}-01-01$/u.test(from) && to === `${from.slice(0, 4)}-12-31`) return from.slice(0, 4);
  const [y = '', m = ''] = from.split('-');
  const last = new Date(Date.UTC(Number(y), Number(m), 0)).getUTCDate();
  if (from.endsWith('-01') && to === `${y}-${m}-${String(last)}`) {
    return new Date(`${from}T00:00:00Z`).toLocaleDateString('en-GB', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });
  }
  if (from === '') return `on or before ${longDate(to)}`;
  if (to === '') return `on or after ${longDate(from)}`;
  return `${longDate(from)} to ${longDate(to)}`;
}

/**
 * A condition as one chip: its field, muted, then what it holds ("Team
 * Engineering", "Missing Bank account", "Start 2026").
 */
export function chipOf(
  fields: readonly DirectoryField[],
  condition: DirectoryCondition,
): { field: string; text: string } {
  const field = fields.find((f) => f.key === condition.key);
  const label = field?.label ?? condition.key;
  const shown = (v: string) =>
    field?.options.find((o) => o.value === v)?.label ??
    (field?.kind === 'date' && /^\d{4}-\d{2}-\d{2}$/u.test(v) ? longDate(v) : v);
  const [first = '', second = ''] = condition.values;
  switch (condition.op) {
    case 'empty':
      return { field: 'Missing', text: label };
    case 'not_empty':
      return { field: 'Has', text: label };
    case 'between':
      return { field: label, text: spanWords(first, second) };
    // A number's bounds are included: "4 or more" missing details.
    case 'before':
      return {
        field: label,
        text: field?.kind === 'number' ? `${first} or fewer` : `before ${shown(first)}`,
      };
    case 'after':
      return {
        field: label,
        text: field?.kind === 'number' ? `${first} or more` : `after ${shown(first)}`,
      };
    case 'not_in':
      return { field: label, text: `not ${condition.values.map(shown).join(' or ')}` };
    // Everybody below a manager, however deep: "Marco's team".
    case 'under':
      return { field: 'Team of', text: condition.values.map(shown).join(' or ') };
    case 'contains':
      return { field: label, text: `mentions “${first}”` };
    default:
      return { field: label, text: condition.values.map(shown).join(' or ') };
  }
}

/** How tall a row is before it is measured: the table's `estimateRowHeight`. */
const ROW_HEIGHT = 57;

/**
 * Where the reader is in a list that keeps loading, and the way back
 * (AI3, MA2): the first row in view goes into the address as it settles, so
 * Back (or a reload) loads as many pages as it takes and returns to it; the
 * last row in view is the counter's "150 of 388", and once it is halfway
 * through what is loaded the next page is asked for. The table scrolls in a
 * box of its own (the region it names); cards and the phone's list scroll the
 * page.
 */
function usePlace({
  wrapper,
  rows,
  window: pageScrolls,
  place,
  onPlaceChange,
  loadMore,
  loading,
  done,
}: {
  readonly wrapper: { readonly current: HTMLDivElement | null };
  readonly rows: readonly DirectoryPerson[];
  readonly window: boolean;
  readonly place: number | null;
  readonly onPlaceChange: ((row: number | null) => void) | undefined;
  readonly loadMore: (() => void) | undefined;
  readonly loading: boolean;
  readonly done: boolean;
}): Place {
  // A store rather than state: the place moves on nearly every scroll frame,
  // and as state it re-rendered the whole directory, table and all, on each.
  // Only the counter reads it (`PlacePill`).
  const [at] = useState(() => {
    let value = { top: 0, last: 0 };
    const listeners = new Set<() => void>();
    return {
      get: () => value,
      set: (next: { top: number; last: number }) => {
        if (next.top === value.top && next.last === value.last) return;
        value = next;
        for (const listener of listeners) listener();
      },
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    };
  });
  const setAt = at.set;
  const restore = useRef<number | null>(place !== null && place > 1 ? place - 1 : null);
  const tell = useRef(onPlaceChange);
  tell.current = onPlaceChange;
  // The rows are a new list on every render: read the latest when measuring, rather than
  // subscribing again (which would cancel the settle timer each time the counter moves).
  const latest = useRef(rows);
  latest.current = rows;
  const more = useRef(loadMore);
  more.current = loadMore;
  const box = (): HTMLElement | null =>
    pageScrolls ? null : (wrapper.current?.querySelector<HTMLElement>('[role="region"]') ?? null);

  useEffect(() => {
    const root = wrapper.current;
    if (root === null) return undefined;
    let frame = 0;
    let settle: ReturnType<typeof setTimeout> | undefined;
    const measure = (): void => {
      frame = 0;
      const scroller = box();
      const edge = scroller?.getBoundingClientRect() ?? { top: 0, bottom: window.innerHeight };
      const head = scroller?.querySelector('thead')?.getBoundingClientRect().height ?? 0;
      const seen = [
        ...root.querySelectorAll<HTMLElement>('[data-row-id], [data-person-id]'),
      ].filter((el) => {
        const r = el.getBoundingClientRect();
        return r.bottom > edge.top + head + 1 && r.top < edge.bottom;
      });
      const id = (el: HTMLElement | undefined) =>
        el?.dataset['rowId'] ?? el?.dataset['personId'] ?? '';
      const index = new Map(latest.current.map((p, i) => [p.id, i]));
      const top = index.get(id(seen[0])) ?? 0;
      const last = index.get(id(seen.at(-1))) ?? top;
      setAt({ top, last });
      // ponytail: halfway through what is loaded keeps up to twice what was read
      // loaded; a fixed lookahead (one page past the reader) if pages get expensive.
      if (seen.length > 0 && (last + 1) * 2 >= latest.current.length) more.current?.();
      clearTimeout(settle);
      // Noted once the scroll settles, rewriting this entry: a scroll is not a step Back undoes.
      settle = setTimeout(() => {
        if (restore.current === null) tell.current?.(top > 0 ? top + 1 : null);
      }, 250);
    };
    const onScroll = (): void => {
      if (frame === 0) frame = requestAnimationFrame(measure);
    };
    // Capture: the page may scroll in the shell's own container rather than the window.
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => {
      document.removeEventListener('scroll', onScroll, { capture: true });
      cancelAnimationFrame(frame);
      clearTimeout(settle);
    };
  }, [pageScrolls]);

  // Back to a place: as many pages as it takes, then the row.
  useEffect(() => {
    const want = restore.current;
    if (want === null) return;
    if (rows.length <= want && !done) {
      if (!loading) loadMore?.();
      return;
    }
    restore.current = null;
    const to = Math.min(want, rows.length - 1);
    const id = rows[to]?.id ?? '';
    const find = () =>
      wrapper.current?.querySelector<HTMLElement>(
        `[data-row-id="${CSS.escape(id)}"], [data-person-id="${CSS.escape(id)}"]`,
      );
    const scroller = box();
    // A virtualized table mounts the row only once it is near: get there first.
    if (scroller !== null) scroller.scrollTop = to * ROW_HEIGHT;
    requestAnimationFrame(() => {
      find()?.scrollIntoView({ block: 'start' });
    });
  }, [rows.length, loading, done]);

  const toTop = (): void => {
    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const scroller = box();
    if (scroller === null) {
      wrapper.current?.scrollIntoView({ block: 'start', behavior: smooth ? 'smooth' : 'auto' });
    } else {
      scroller.scrollTo({ top: 0, behavior: smooth ? 'smooth' : 'auto' });
    }
    setAt({ top: 0, last: 0 });
    tell.current?.(null);
  };
  return { get: at.get, subscribe: at.subscribe, toTop };
}

interface Place {
  readonly get: () => { readonly top: number; readonly last: number };
  readonly subscribe: (listener: () => void) => () => void;
  readonly toTop: () => void;
}

/** "150 of 388" and Back to top, once the reader is past the first row. */
function PlacePill({
  place,
  total,
  className,
}: {
  readonly place: Place;
  readonly total: number;
  readonly className: string;
}): JSX.Element | null {
  const at = useSyncExternalStore(place.subscribe, place.get, place.get);
  if (at.top === 0) return null;
  return (
    <ScrollPosition onBackToTop={place.toTop} className={className}>
      {`${(at.last + 1).toLocaleString('en-GB')} of ${total.toLocaleString('en-GB')}`}
    </ScrollPosition>
  );
}

function Body({
  state,
  search,
  onSearchChange,
  filters,
  onFiltersChange,
  onConditionsChange,
  onSortChange,
  segmentId = null,
  onView,
  onSaveSegment,
  onOpen,
  onExport,
  onImport,
  running = null,
  onBulkEdit,
  onNextPage,
  onFirstPage,
  onLoadMore,
  view = 'list',
  next = null,
  group = null,
  onGroupChange,
  incomplete = false,
  onAsk,
  asked = null,
  onRemind,
  place = null,
  onPlaceChange,
}: DirectoryProps & { readonly state: DirectoryState }): JSX.Element {
  const coarse = useCoarsePointer();
  const keys = useShortcutKeys();
  const busyId = useId();
  const smart = onAsk !== undefined;
  // Without smart search the field searches names as they are typed; with it, Enter asks.
  const [typed, type] = useTyped(search, smart ? undefined : onSearchChange);
  // The person the quick look is on. Until somebody chooses (undefined), the
  // first, so the page opens on a record and the keyboard starts there; null
  // once they close it. A new query starts on its own first person.
  const [chosen, setPeek] = useState<string | null | undefined>(undefined);
  const [chosenIn, setChosenIn] = useState(state.people);
  if (chosenIn !== state.people) {
    setChosenIn(state.people);
    setPeek(undefined);
  }
  const tableRef = useRef<DataTableHandle | null>(null);
  const columnsChosen = useColumns(state.columns);
  const widths = useWidths();
  const loaded = useRows(state.people, next, onLoadMore);
  const endOfPage = useEndOfPage(
    (coarse || view === 'cards') && loaded.loadMore !== undefined,
    loaded.loading,
    loaded.loadMore,
  );
  const wrapper = useRef<HTMLDivElement | null>(null);
  const placed = usePlace({
    wrapper,
    rows: loaded.rows,
    window: coarse || view === 'cards',
    place,
    onPlaceChange,
    loadMore: loaded.loadMore,
    loading: loaded.loading,
    done: loaded.done,
  });

  // Smart search: the question in the box, and what People made of it.
  const [recent, addRecent] = useRecent();
  const [question, setQuestion] = useState(asked ?? search);
  useEffect(() => {
    setQuestion(asked ?? search);
  }, [asked, search]);
  const [answer, setAnswer] = useState<{ sentence: string; answer: Answered } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [reminding, setReminding] = useState(false);
  const [reminded, setReminded] = useState<string | null>(null);
  useEffect(() => {
    // Back to a question asked before: what it was understood as, without asking again.
    setAnswer((a) => {
      if (asked === null) return null;
      if (a?.sentence === asked) return a;
      // Written by this screen, for this tab: an answer it drew before.
      const cached = cachedAnswer(asked) as Answered | null;
      return cached === null ? null : { sentence: asked, answer: cached };
    });
  }, [asked]);
  /** What the question was understood as, changed and kept for Back. */
  const revise = (change: (a: Answered) => Answered): void => {
    if (answer === null) return;
    const next = change(answer.answer);
    cacheAnswer(answer.sentence, next);
    setAnswer({ sentence: answer.sentence, answer: next });
  };
  const askIt = (sentence: string): void => {
    if (onAsk === undefined) return;
    const text = sentence.trim();
    setFailed(null);
    setReminded(null);
    if (text === '') {
      // Cleared: the question and the filters it became go together.
      setAnswer(null);
      if (asked !== null || search !== '') void onAsk('', {});
      return;
    }
    setReading(true);
    void onAsk(text, rememberedReadings()).then((got) => {
      setReading(false);
      if (!got.ok) {
        setFailed(`“${text}” could not be read: ${got.message}`);
        return;
      }
      addRecent(text);
      if (got.by === 'person' || got.by === 'search') {
        setAnswer(null);
        return;
      }
      cacheAnswer(text, got);
      setAnswer({ sentence: text, answer: got });
    });
  };
  const fields = state.fields ?? [];
  const conditions = state.query?.conditions ?? [];
  const match = state.query?.match === 'any' ? 'any' : 'all';
  const sort = state.query?.sort ?? null;
  const top = state.query?.top ?? null;
  const metrics = state.metrics ?? [];
  const kindOf = new Map(fields.map((f) => [f.key, f.kind]));
  // What people can be grouped by: a choice, a place, a manager, a status.
  const groupable = fields.filter(
    (f) => f.kind === 'select' || f.kind === 'status' || f.kind === 'person',
  );
  const grouping = groupable.find((f) => f.key === group) ?? null;
  const groupOf = (p: DirectoryPerson): string =>
    grouping === null
      ? ''
      : (p.people?.find((r) => r.key === grouping.key)?.name ??
        (p.values[grouping.key] || `No ${grouping.label.toLowerCase()}`));

  // Nobody at all, rather than nobody matching: say so, and where adding
  // happens. No buttons of its own: Import is in the header and adding one
  // person is People's manifest action beside every screen.
  const narrowed =
    asked !== null ||
    search.trim() !== '' ||
    Object.keys(filters).length > 0 ||
    conditions.length > 0 ||
    incomplete ||
    segmentId !== null ||
    onFirstPage !== undefined;
  if (state.people.length === 0 && !narrowed) {
    return (
      <EmptyState
        title="No employees yet"
        description={
          onImport === undefined
            ? 'Nobody has been added to People yet.'
            : 'Add people one at a time with Add person, or import a spreadsheet of everybody.'
        }
        // Import lives in Import & export; an empty directory is where it is wanted first.
        action={
          onImport === undefined ? undefined : running !== null && isRunning(running) ? (
            <div className="flex flex-col items-center gap-2">
              <Button startIcon={<icons.upload aria-hidden />} disabled aria-describedby={busyId}>
                Import
              </Button>
              <ImportBusy id={busyId} run={running} />
            </div>
          ) : (
            <Button startIcon={<icons.upload aria-hidden />} onClick={onImport}>
              Import
            </Button>
          )
        }
      />
    );
  }

  const cell = (p: DirectoryPerson, c: DirectoryColumn): ReactNode => {
    // A manager is a person: their face and their full name.
    const ref = p.people?.find((r) => r.key === c.key);
    if (ref !== undefined) {
      return (
        <span className="flex min-w-0 items-center gap-2">
          <Avatar size="sm" name={ref.name} src={ref.avatarUrl ?? undefined} />
          <span className="truncate">{ref.name}</span>
        </span>
      );
    }
    const value = p.values[c.key];
    if (value === undefined || value === '') return <span className="text-fg-subtle">—</span>;
    if (c.key === 'status') {
      return (
        <Badge size="sm" dot tone={STATUS_TONE[value] ?? 'neutral'}>
          {value}
        </Badge>
      );
    }
    if (kindOf.get(c.key) === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return <span className="whitespace-nowrap tabular-nums">{longDate(value)}</span>;
    }
    if (c.key === 'employee_number') return <span className="font-mono text-sm">{value}</span>;
    return value;
  };

  const byKey = new Map(state.columns.map((c) => [c.key, c]));
  const shown = columnsChosen.value.order.filter(
    (k) => k !== PERSON && columnsChosen.value.visible.includes(k) && byKey.has(k),
  );
  const shownColumns = shown.flatMap((k) => byKey.get(k) ?? []);
  /** "Backend engineer · Madrid": the first two columns People shows, in words. */
  const lineOf = (p: DirectoryPerson): string =>
    shownColumns
      .filter((c) => c.key !== 'status' && p.people?.some((r) => r.key === c.key) !== true)
      .map((c) => p.values[c.key])
      .filter((v) => v !== undefined && v !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(v))
      .slice(0, 2)
      .join(' · ');

  const rows = loaded.rows;
  const peek = chosen === undefined ? (rows[0]?.id ?? null) : chosen;
  const peeked = rows.find((p) => p.id === peek) ?? null;
  /**
   * The quick look to the person above or below: the one way the selection
   * moves, from the list (focus follows, onto their name) and from the card
   * (focus stays in the card, and their row comes into view).
   */
  const move = (step: 1 | -1, from: 'list' | 'card'): void => {
    const at = rows.findIndex((p) => p.id === peek);
    const to = rows[at + step];
    if (to === undefined) return;
    setPeek(to.id);
    if (from === 'list') document.getElementById(`person-${to.id}`)?.focus();
    else tableRef.current?.revealRow(to.id);
  };

  const nameCell = (p: DirectoryPerson): JSX.Element => (
    <span className="flex min-w-0 items-center gap-3">
      <Avatar size="md" name={p.name} src={p.avatarUrl ?? undefined} />
      <span className="min-w-0">
        {/*
          The name is the row's control: a click or ↵ opens their quick look,
          ↑ ↓ walk the people without leaving the list, and the profile is
          the row's Edit key (E) or the card's Open profile.
        */}
        <button
          id={`person-${p.id}`}
          type="button"
          className="block max-w-full truncate rounded-xs text-start font-semibold text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
          onClick={(event) => {
            event.stopPropagation();
            setPeek(p.id);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              setPeek(p.id);
            } else if (pressed(event, 'row.edit', keys)) {
              event.preventDefault();
              onOpen(p.id);
            } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              const step = event.key === 'ArrowDown' ? 1 : -1;
              if (peek !== null) {
                move(step, 'list');
                return;
              }
              const to = rows[rows.findIndex((r) => r.id === p.id) + step];
              document.getElementById(`person-${to?.id ?? ''}`)?.focus();
            } else if (event.key === 'Escape' && peek !== null) {
              setPeek(null);
            }
          }}
        >
          {p.name}
        </button>
        {p.email === null ? null : (
          <span className="block truncate text-xs text-fg-muted">{p.email}</span>
        )}
      </span>
    </span>
  );

  const columns: DataColumn<DirectoryPerson>[] = [
    {
      id: PERSON,
      header: 'Name',
      width: '17rem',
      sticky: true,
      sortBy: (p) => p.name,
      cell: nameCell,
    },
    ...shownColumns.map((c): DataColumn<DirectoryPerson> => ({
      id: c.key,
      header: c.label,
      ...(c.sortable === false || onSortChange === undefined || grouping !== null
        ? {}
        : { sortBy: (p: DirectoryPerson) => p.values[c.key] ?? '' }),
      cell: (p) => cell(p, c),
    })),
  ];
  if (state.people.some((p) => p.missing !== null)) {
    columns.push({
      id: 'record',
      header: 'Record',
      width: '9rem',
      cell: (p) =>
        p.missing === null ? null : p.missing === 0 ? (
          <Badge tone="success" size="sm">
            Complete
          </Badge>
        ) : (
          <MissingMark count={p.missing} />
        ),
    });
  }

  // The chips: every condition in force, each removable, then Clear all.
  const chips: { key: string; field: string; text: string; remove: () => void }[] = [
    ...conditions.map((c, i) => ({
      key: `c${String(i)}`,
      field: '',
      text: describeCondition(fields, c),
      remove: () => {
        onConditionsChange?.(
          conditions.filter((_, j) => j !== i),
          match,
        );
      },
    })),
    ...Object.entries(filters).map(([key, value]) => {
      const f = state.filterable.find((x) => x.key === key);
      return {
        key: `f${key}`,
        field: f?.label ?? key,
        text: f?.options.find((o) => o.value === value)?.label ?? value,
        remove: () => {
          onFiltersChange(Object.fromEntries(Object.entries(filters).filter(([k]) => k !== key)));
        },
      };
    }),
  ];

  const tableSort: DataTableSort | null =
    sort === null
      ? null
      : {
          columnId: sort.key === 'name' ? PERSON : sort.key,
          direction: sort.direction === 'asc' ? 'ascending' : 'descending',
        };

  const empty = (
    <EmptyState
      title="Nobody matches"
      description={
        asked !== null
          ? 'Nobody matches what the question was understood as. Remove a chip, or ask it differently.'
          : 'Remove a filter or change the search to see more people.'
      }
    />
  );

  const table = coarse ? (
    // Under a finger: a list of people, each row their profile.
    rows.length === 0 ? (
      empty
    ) : (
      <List aria-label="People">
        {rows.map((p) => (
          <ListItem
            key={p.id}
            asChild
            selected={p.id === peek}
            leading={
              <Avatar
                name={p.name}
                src={p.avatarUrl ?? undefined}
                size="xl"
                {...(p.values['status'] === 'Active'
                  ? { status: 'success' as const, statusLabel: 'Active' }
                  : p.values['status'] === 'On leave'
                    ? { status: 'info' as const, statusLabel: 'On leave' }
                    : {})}
              />
            }
            description={lineOf(p)}
            {...(p.values['status'] === undefined || p.values['status'] === 'Active'
              ? { chevron: true }
              : {
                  trailing: (
                    <Badge size="sm" tone={STATUS_TONE[p.values['status']] ?? 'neutral'}>
                      {p.values['status']}
                    </Badge>
                  ),
                })}
          >
            <a
              href={`/people/${p.id}`}
              data-person-id={p.id}
              {...(p.id === peek ? { 'aria-current': true } : {})}
              onClick={(event) => {
                event.preventDefault();
                onOpen(p.id);
              }}
            >
              {p.name}
            </a>
          </ListItem>
        ))}
        {loaded.loading ? (
          // The next person's row, in its shape, until they arrive.
          <ListItem
            aria-hidden
            leading={<Skeleton className="size-14 rounded-full" />}
            description={<Skeleton className="mt-1.5 h-3 w-32" />}
          >
            <Skeleton className="h-4 w-44" />
          </ListItem>
        ) : null}
      </List>
    )
  ) : view === 'cards' ? (
    rows.length === 0 ? (
      empty
    ) : (
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,12.5rem),1fr))] gap-3.5">
        {rows.map((p) => (
          <li key={p.id} data-person-id={p.id} className="min-w-0">
            <PersonCard
              name={p.name}
              description={lineOf(p)}
              {...(p.avatarUrl === null ? {} : { avatarSrc: p.avatarUrl })}
              {...(p.values['status'] === 'Active'
                ? { status: 'success' as const, statusLabel: 'Active' }
                : p.values['status'] === 'On leave'
                  ? { status: 'info' as const, statusLabel: 'On leave' }
                  : {})}
              badges={
                p.missing === null || p.missing === 0 ? undefined : (
                  <MissingMark count={p.missing} />
                )
              }
              actions={
                <>
                  {p.email === null ? null : (
                    <Button asChild size="xs" aria-label={`Email ${p.name}`}>
                      <a href={`mailto:${p.email}`}>
                        <icons.email aria-hidden />
                      </a>
                    </Button>
                  )}
                  <Button
                    size="xs"
                    onClick={() => {
                      onOpen(p.id);
                    }}
                  >
                    Profile
                  </Button>
                </>
              }
              className="h-full"
            />
          </li>
        ))}
        {loaded.loading
          ? // A row of cards, in their shape, until the next page arrives.
            ['a', 'b', 'c', 'd'].map((k) => (
              <li key={`loading-${k}`} aria-hidden className="min-w-0">
                <Skeleton className="h-full min-h-60 rounded-xl" />
              </li>
            ))
          : null}
      </ul>
    )
  ) : (
    <DataTable
      ref={tableRef}
      label="People"
      rows={rows}
      {...(grouping === null ? {} : { groupBy: groupOf })}
      resizable
      columnWidths={widths.widths}
      onColumnWidthsChange={widths.choose}
      activeRowId={peek}
      // Infinite: the table scrolls in a box of its own, the next page
      // loads near the end, and past 100 rows only what is on screen is
      // mounted (Reach's `auto`). The box is the height the window has left
      // (`page-fill`), so it is the page's one scroll; a window too short for
      // it scrolls as well, rather than hiding the rest. Outside a layout
      // that fills, it is at most the window's height.
      estimateRowHeight={57}
      containerClassName="page-fill max-h-dvh min-h-96"
      {...(loaded.loadMore === undefined ? {} : { onEndReached: loaded.loadMore })}
      loadingMore={loaded.loading}
      columns={columns}
      rowId={(p) => p.id}
      describeRow={(p) => p.name}
      onRowClick={(p) => {
        setPeek(p.id);
      }}
      // Enter or O opens the card, as a click does; the profile is the
      // row's Edit key or the card's Open profile. Space toggles the card.
      onRowOpen={(p) => {
        setPeek(p.id);
      }}
      onRowPreview={(p) => {
        setPeek(peek === p.id ? null : p.id);
      }}
      rowActions={(p) => [
        {
          id: 'edit',
          label: 'Edit profile',
          shortcut: 'row.edit',
          icon: <icons.edit aria-hidden />,
          onSelect: () => {
            onOpen(p.id);
          },
        },
      ]}
      {...(onSortChange === undefined || grouping !== null
        ? {}
        : {
            sort: tableSort,
            onSortChange: (s: DataTableSort | null) => {
              onSortChange(
                s === null
                  ? null
                  : {
                      key: s.columnId === PERSON ? 'name' : s.columnId,
                      direction: s.direction === 'ascending' ? 'asc' : 'desc',
                    },
              );
            },
          })}
      {...(onBulkEdit === undefined
        ? {}
        : {
            selectable: true,
            // One floating bar, one action (C6).
            bulkActions: (picked: DirectoryPerson[]) => (
              <>
                <span className="me-1.5 text-sm font-medium opacity-75">Esc to clear</span>
                <Button
                  size="sm"
                  variant="primary"
                  startIcon={<icons.edit aria-hidden />}
                  onClick={() => {
                    onBulkEdit(picked.map((p) => p.id));
                  }}
                >
                  Edit together
                </Button>
              </>
            ),
          })}
      stickyHeader
      empty={empty}
    />
  );
  // Where the reader is in a list that keeps loading, and the way back: at
  // the list's own top corner, never over the quick look beside it.
  const pill =
    onLoadMore === undefined ? null : (
      <PlacePill
        place={placed}
        total={state.total}
        className={
          coarse || view === 'cards' ? 'fixed end-4 bottom-40 z-20' : 'absolute end-4.5 top-15 z-10'
        }
      />
    );
  const profileKeys = keysOf('row.edit', keys);
  const previewKeys = keysOf('list.preview', keys);
  const selectKeys = keysOf('list.select', keys);

  // Smart search's row: the conditions in force as the chips a question
  // became, the order when it is not by name, and the parts not used.
  const fromQuestion = smart && asked !== null;
  const understood: UnderstoodChip[] = [
    ...conditions.map((c, i) => ({
      key: `c${String(i)}`,
      ...chipOf(fields, c),
      onRemove: () => {
        onConditionsChange?.(
          conditions.filter((_, j) => j !== i),
          match,
        );
      },
    })),
    ...(grouping === null || onGroupChange === undefined
      ? []
      : [
          {
            key: 'group',
            field: 'Grouped by',
            text: grouping.label,
            onRemove: () => {
              onGroupChange(null);
            },
          },
        ]),
    ...(sort === null ||
    (sort.key === 'name' && top === null) ||
    grouping !== null ||
    onSortChange === undefined
      ? []
      : [
          {
            key: 'sort',
            field: 'Sorted by',
            // "most missing details · top 1"
            text: `${orderWords(sort, fields, metrics).replace(/^(ordered|sorted) by /u, '')}${
              top === null ? '' : ` · top ${String(top)}`
            }`,
            onRemove: () => {
              onSortChange(null);
            },
          },
        ]),
  ];
  const said = answer?.answer;
  const unusedParts = [
    ...(said?.refused ?? []).map((r) => ({
      key: `r:${r.text}`,
      text: r.text,
      onRemove: () => {
        revise((a) => ({ ...a, refused: (a.refused ?? []).filter((x) => x.text !== r.text) }));
      },
    })),
    ...(said?.unused ?? []).map((u) => ({
      key: `u:${u}`,
      text: u,
      onRemove: () => {
        revise((a) => ({ ...a, unused: a.unused.filter((x) => x !== u) }));
      },
    })),
  ];
  const remembered =
    said?.remembered == null
      ? null
      : `“${said.remembered.phrase}” read as you chose before: ${said.remembered.label}.`;
  const sayNote = [remembered, said?.note ?? null].filter((x) => x !== null).join(' ') || null;
  // What was not understood, said in words beside the dashed chips; then anything else to say.
  const notUnderstood =
    (said?.unused ?? []).length === 0
      ? null
      : `Not understood: ${(said?.unused ?? []).map((u) => `“${u}”`).join(', ')}.`;
  const sayNotes = [
    ...(notUnderstood === null ? [] : [notUnderstood]),
    ...(said?.notes ?? []),
    ...(sayNote === null ? [] : [sayNote]),
  ];
  const remindKeys = state.remind ?? null;
  const canRemind = onRemind !== undefined && remindKeys !== null && state.total > 0;
  const remindAll = (): void => {
    if (onRemind === undefined || remindKeys === null) return;
    setReminding(true);
    setReminded(null);
    void onRemind(conditions, match).then((done) => {
      setReminding(false);
      const what = remindKeys
        .map((k) => (fields.find((f) => f.key === k)?.label ?? k).toLowerCase())
        .join(' and ');
      setReminded(
        done.ok
          ? `Asked ${peopleCount(done.asked)} for their ${what}.${done.more ? ' That is the first 500; remind again for the rest.' : ''}`
          : done.message,
      );
    });
  };
  const remindButton = canRemind ? (
    <Button
      size={coarse ? 'xs' : 'sm'}
      startIcon={<icons.notifications aria-hidden />}
      loading={reminding}
      loadingLabel="Reminding"
      onClick={remindAll}
    >
      {coarse ? 'Remind all' : `Remind all ${state.total.toLocaleString('en-GB')}`}
    </Button>
  ) : null;
  const saveable =
    onSaveSegment !== undefined && (Object.keys(filters).length > 0 || conditions.length > 0);

  return (
    <Stack gap={4}>
      <Views
        state={state}
        conditions={conditions}
        segmentId={segmentId}
        incomplete={incomplete}
        {...(onView === undefined ? {} : { onView })}
      />
      {smart ? (
        <div className="flex min-w-0 flex-col gap-3">
          <AskBar
            value={question}
            onValueChange={setQuestion}
            onAsk={askIt}
            loading={reading}
            suggestions={state.suggestions ?? []}
            recent={recent}
          />
          {failed === null ? null : (
            <p role="status" className="text-sm text-danger-fg">
              {failed}
            </p>
          )}
          <NeedsYou
            refused={said?.refused ?? []}
            ask={said?.ask ?? null}
            coarse={coarse}
            onPick={(r) => {
              const topic = said?.ask?.topic;
              if (topic != null) rememberReading(topic, r.label);
              revise((a) => ({ ...a, ask: null }));
              onConditionsChange?.(r.conditions, r.match);
            }}
            onUse={(r) => {
              if (r.instead === null) return;
              revise((a) => ({
                ...a,
                refused: (a.refused ?? []).filter((x) => x.text !== r.text),
              }));
              onConditionsChange?.([...conditions, r.instead.condition], 'all');
            }}
            onRemove={(r) => {
              revise((a) => ({
                ...a,
                refused: (a.refused ?? []).filter((x) => x.text !== r.text),
              }));
              setQuestion((q) => q.replace(r.text, '').replaceAll(/\s+/gu, ' ').trim());
            }}
          />
          {fromQuestion && understood.length + unusedParts.length + sayNotes.length > 0 ? (
            <Understood
              chips={understood}
              unused={unusedParts}
              {...(onConditionsChange === undefined || fields.length === 0
                ? {}
                : {
                    onEdit: () => {
                      setFiltersOpen(true);
                    },
                  })}
              notes={sayNotes}
            />
          ) : null}
        </div>
      ) : null}
      {coarse && fromQuestion ? (
        // Under a finger: how many, and the one thing to do about them, in thumb reach.
        <div className="flex items-center gap-3">
          <p className="text-base font-bold text-fg">{peopleCount(state.total)}</p>
          {remindButton === null ? null : <span className="ms-auto">{remindButton}</span>}
        </div>
      ) : null}
      {/*
        One toolbar (C1): the filters in force as chips, then the view and the
        export. Sort, group and columns are one View menu rather than three
        controls; after a question the chips are the question's, above, and
        this row says how many it found and what to do with them.
      */}
      <Toolbar
        {...(smart
          ? {}
          : {
              search: (
                <SearchField
                  label="Search people"
                  placeholder="Search by name, email or employee number"
                  size="sm"
                  value={typed}
                  onValueChange={type}
                  // The toolbar's search slot sets the width: a fixed one overran the chips beside it.
                  containerClassName="w-full"
                />
              ),
            })}
        filters={
          fromQuestion ? (
            coarse ? undefined : (
              <p className="flex items-baseline gap-2.5 text-sm text-fg-muted">
                <span className="text-base font-bold text-fg">{peopleCount(state.total)}</span>
                Updates as you edit the chips
              </p>
            )
          ) : (
            <ChipRow role="group" aria-label="Filters in force">
              {match === 'any' && conditions.length > 1 ? (
                <span className="text-xs text-fg-muted">Any of:</span>
              ) : null}
              {chips.map((chip) => (
                <Chip
                  key={chip.key}
                  {...(chip.field === '' ? {} : { field: chip.field })}
                  onRemove={chip.remove}
                  removeLabel={`Remove ${chip.field === '' ? '' : `${chip.field} `}${chip.text}`}
                >
                  {chip.text}
                </Chip>
              ))}
              {onConditionsChange === undefined || fields.length === 0 ? null : (
                <Chip
                  variant="dashed"
                  startIcon={<icons.add aria-hidden />}
                  onClick={() => {
                    setFiltersOpen(true);
                  }}
                >
                  Add filter
                </Chip>
              )}
              {chips.length === 0 ? null : (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    if (conditions.length > 0) onConditionsChange?.([], 'all');
                    if (Object.keys(filters).length > 0) onFiltersChange({});
                  }}
                >
                  Clear all
                </Button>
              )}
              {saveable ? <SaveSegment onSave={onSaveSegment} /> : null}
            </ChipRow>
          )
        }
        actions={
          coarse ? undefined : (
            <span className="flex flex-wrap items-center gap-2">
              {fromQuestion ? remindButton : null}
              {fromQuestion && saveable ? (
                <SaveSegment onSave={onSaveSegment} label="Save as view" />
              ) : null}
              <ViewMenu
                columns={state.columns}
                chosen={columnsChosen}
                metrics={onSortChange === undefined ? [] : metrics}
                sort={sort}
                onSortChange={onSortChange}
                groupable={onGroupChange === undefined || view !== 'list' ? [] : groupable}
                group={grouping?.key ?? null}
                onGroupChange={onGroupChange}
              />
              {onExport === undefined ? null : (
                <Button
                  size="sm"
                  variant="ghost"
                  startIcon={<icons.download aria-hidden />}
                  onClick={onExport}
                >
                  Export
                </Button>
              )}
            </span>
          )
        }
      />
      {onConditionsChange === undefined || fields.length === 0 ? null : (
        <Filters
          open={filtersOpen}
          onOpenChange={setFiltersOpen}
          fields={fields}
          metrics={metrics}
          conditions={conditions}
          match={match}
          onApply={onConditionsChange}
        />
      )}
      {reminded === null ? null : (
        <p role="status" className="text-sm text-fg-muted">
          {reminded}
        </p>
      )}
      <div ref={wrapper} className="relative">
        {peeked !== null && view === 'list' && !coarse ? (
          // One row, the table's: the height the page gives it, which the
          // card beside it does not stretch to.
          <div className="grid grid-cols-[minmax(0,1fr)_21.25rem] grid-rows-[minmax(0,1fr)] gap-4">
            <div className="relative min-w-0">
              {table}
              {pill}
            </div>
            <QuickLook
              className="max-h-full self-start overflow-y-auto"
              // Its keys are the list's, said once under the list.
              hideHints
              media={
                <Avatar
                  name={peeked.name}
                  src={peeked.avatarUrl ?? undefined}
                  size="2xl"
                  {...(peeked.values['status'] === 'Active'
                    ? { status: 'success' as const, statusLabel: 'Active' }
                    : {})}
                />
              }
              title={peeked.name}
              description={lineOf(peeked)}
              href={`/people/${peeked.id}`}
              onOpen={() => {
                onOpen(peeked.id);
              }}
              onClose={() => {
                setPeek(null);
                document.getElementById(`person-${peeked.id}`)?.focus();
              }}
              onPrevious={() => {
                move(-1, 'card');
              }}
              onNext={() => {
                move(1, 'card');
              }}
              actions={
                <>
                  {peeked.email === null ? null : (
                    <Button asChild size="sm" startIcon={<icons.email aria-hidden />}>
                      <a href={`mailto:${peeked.email}`}>Email</a>
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => {
                      onOpen(peeked.id);
                    }}
                  >
                    Open profile
                  </Button>
                </>
              }
            >
              <KeyValues
                items={shownColumns
                  .slice(0, 5)
                  .map((c) => ({ id: c.key, label: c.label, value: cell(peeked, c) }))}
              />
              {peeked.missing === null || peeked.missing === 0 ? null : (
                <p className="flex items-center gap-2 text-sm text-fg-muted">
                  <MissingMark count={peeked.missing} />
                  required {peeked.missing === 1 ? 'detail' : 'details'} to fill in
                </p>
              )}
              {/*
                Back to their row, wherever the list has scrolled: smoothly,
                unless motion is reduced, and the keyboard lands on it. Always
                there, so the card does not change shape as the row scrolls in
                and out of view; on a row in full view it only moves focus.
              */}
              <Button
                size="sm"
                variant="ghost"
                startIcon={<icons.list aria-hidden />}
                onClick={() => {
                  tableRef.current?.revealRow(peeked.id, { focus: true });
                }}
              >
                Show in list
              </Button>
            </QuickLook>
          </div>
        ) : (
          <>
            {table}
            {pill}
          </>
        )}
      </div>
      {(coarse || view === 'cards') && loaded.loadMore !== undefined ? (
        <div ref={endOfPage} aria-hidden className="h-px" />
      ) : null}
      {coarse ? null : (
        // The list's keys, and how it loads, in one line under it (C1).
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-muted">
          {view === 'list' && rows.length > 0 ? (
            <>
              <span className="flex items-center gap-1.5">
                <Kbd keyName="up" />
                <Kbd keyName="down" /> move
              </span>
              {previewKeys.length === 0 ? null : (
                <span className="flex items-center gap-1.5">
                  <KbdShortcut keys={previewKeys} /> quick look
                </span>
              )}
              {profileKeys.length === 0 ? null : (
                <span className="flex items-center gap-1.5">
                  <KbdShortcut keys={profileKeys} /> profile
                </span>
              )}
              {onBulkEdit === undefined || selectKeys.length === 0 ? null : (
                <span className="flex items-center gap-1.5">
                  <KbdShortcut keys={selectKeys} /> select
                </span>
              )}
            </>
          ) : null}
          {onLoadMore === undefined ? null : (
            // Said as each page lands, to a screen reader too: "50 more loaded".
            // The line itself holds still: pages load a page ahead of the reader,
            // so a "Loading" swapped in each time would blink under a scroll that
            // never waits. Where they would wait, the rows' own skeleton says so.
            <p role="status" className="ms-auto">
              {loaded.added === null || loaded.loading ? null : (
                <span className="sr-only">{loaded.added} more loaded. </span>
              )}
              {`Loads ${String(DIRECTORY_PAGE)} at a time${sort === null ? '' : ` · ${orderWords(sort, fields, metrics)}`}`}
            </p>
          )}
        </div>
      )}
      {fromQuestion && said?.by === 'assistant' ? (
        <p className="flex items-center gap-1.5 text-xs text-fg-muted">
          <icons.assistant aria-hidden className="size-3" />
          Read by the assistant: it saw your sentence and field names, never a value. Every chip is
          an ordinary filter in the address.
        </p>
      ) : null}
      {onLoadMore !== undefined ||
      (onNextPage === undefined && onFirstPage === undefined) ? null : (
        <nav aria-label="Pages of people" className="flex justify-end gap-2">
          {onFirstPage === undefined ? null : <Button onClick={onFirstPage}>First page</Button>}
          {onNextPage === undefined ? null : <Button onClick={onNextPage}>Next page</Button>}
        </nav>
      )}
    </Stack>
  );
}

/** The columns chosen, remembered in this browser; the schema's defaults until then. */
function useColumns(columns: readonly DirectoryColumn[]) {
  const defaults: ColumnChooserValue = {
    order: [PERSON, ...columns.map((c) => c.key)],
    visible: [PERSON, ...columns.filter((c) => c.shown !== false).map((c) => c.key)],
  };
  const [value, setValue] = useState<ColumnChooserValue>(defaults);
  // After the first render, so the server's HTML and the browser's first agree.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(COLUMNS_KEY);
      if (saved !== null) setValue(JSON.parse(saved) as ColumnChooserValue);
    } catch {
      // No storage (a private window): the defaults stand.
    }
  }, []);
  const choose = (next: ColumnChooserValue | null) => {
    setValue(next ?? defaults);
    try {
      if (next === null) window.localStorage.removeItem(COLUMNS_KEY);
      else window.localStorage.setItem(COLUMNS_KEY, JSON.stringify(next));
    } catch {
      // Remembered for this page only.
    }
  };
  // A column the schema no longer offers is dropped; one added since is at the end, hidden.
  const known = new Set(defaults.order);
  const order = [
    ...value.order.filter((k) => known.has(k)),
    ...defaults.order.filter((k) => !value.order.includes(k)),
  ];
  return { value: { order, visible: value.visible.filter((k) => known.has(k)) }, choose };
}

/**
 * One "View" menu (C1b): the order, the grouping and the columns, which were
 * three controls in the toolbar. Sorting by a metric and grouping are
 * People's, in the address; the columns are this browser's. Grouping turns
 * sorting off, as it orders by the group.
 */
function ViewMenu({
  columns,
  chosen,
  metrics,
  sort,
  onSortChange,
  groupable,
  group,
  onGroupChange,
}: {
  readonly columns: readonly DirectoryColumn[];
  readonly chosen: ReturnType<typeof useColumns>;
  readonly metrics: readonly DirectoryMetric[];
  readonly sort: DirectorySort | null;
  readonly onSortChange: DirectoryProps['onSortChange'];
  readonly groupable: readonly DirectoryField[];
  readonly group: string | null;
  readonly onGroupChange: DirectoryProps['onGroupChange'];
}): JSX.Element {
  const label = 'text-xs font-semibold text-fg-subtle';
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost" startIcon={<icons.adjust aria-hidden />}>
          View
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" aria-label="View" className="flex w-75 flex-col gap-2.5">
        {onSortChange === undefined || metrics.length === 0 ? null : (
          <>
            <p className={label}>Sort by</p>
            <Select
              disabled={group !== null}
              value={
                sort !== null && metrics.some((m) => m.key === sort.key)
                  ? `${sort.key}:${sort.direction}`
                  : ANY
              }
              onValueChange={(value) => {
                const [key = '', direction] = value.split(':');
                onSortChange(
                  value === ANY ? null : { key, direction: direction === 'asc' ? 'asc' : 'desc' },
                );
              }}
            >
              <SelectTrigger aria-label="Sort by" size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>
                  {sort === null || metrics.every((m) => m.key !== sort.key)
                    ? 'Name, or the column chosen'
                    : 'No ranking'}
                </SelectItem>
                {metrics.flatMap((m) => [
                  <SelectItem key={`${m.key}:desc`} value={`${m.key}:desc`}>
                    {capital(m.most)}
                  </SelectItem>,
                  <SelectItem key={`${m.key}:asc`} value={`${m.key}:asc`}>
                    {capital(m.least)}
                  </SelectItem>,
                ])}
              </SelectContent>
            </Select>
          </>
        )}
        {onGroupChange === undefined || groupable.length === 0 ? null : (
          <>
            <p className={label}>Group by</p>
            <Select
              value={group ?? ANY}
              onValueChange={(value) => {
                onGroupChange(value === ANY ? null : value);
              }}
            >
              <SelectTrigger aria-label="Group by" size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>No grouping</SelectItem>
                {groupable.map((f) => (
                  <SelectItem key={f.key} value={f.key}>
                    {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        )}
        <p className={label}>Columns</p>
        <ColumnChooser
          inline
          columns={[
            { id: PERSON, label: 'Name', locked: true },
            ...columns.map((c) => ({ id: c.key, label: c.label })),
          ]}
          value={chosen.value}
          onChange={chosen.choose}
        />
        <div className="flex items-center gap-2">
          <Button
            size="xs"
            variant="ghost"
            onClick={() => {
              chosen.choose(null);
            }}
          >
            Reset columns
          </Button>
          <span className="ms-auto text-xs text-fg-subtle">Kept in this browser</span>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * The advanced filters (C3): conditions, one per row, all or any of them, in
 * a centred dialog, since it is a short task with one outcome. Nothing
 * applies until Apply, so a half-written condition never sends 50,000 people
 * back to be counted. It opens on what is in force.
 */
function Filters({
  open,
  onOpenChange,
  fields,
  metrics,
  conditions,
  match,
  onApply,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly fields: readonly DirectoryField[];
  /** What People works out that may be filtered on too, named under the conditions. */
  readonly metrics: readonly DirectoryMetric[];
  readonly conditions: readonly DirectoryCondition[];
  readonly match: 'all' | 'any';
  readonly onApply: (conditions: readonly DirectoryCondition[], match: 'all' | 'any') => void;
}): JSX.Element {
  const builderFields = filterFields(fields);
  const fromState = (): FilterGroup => ({
    match,
    conditions: conditions.map((c, i) => ({
      id: `c${String(i)}`,
      field: c.key,
      operator: c.op,
      values: c.values,
    })),
  });
  const [draft, setDraft] = useState<FilterGroup>(fromState);
  const complete = draft.conditions.filter((c) => isConditionComplete(builderFields, c));
  // Each opening starts from what is in force; with nothing yet, one empty row.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      const current = fromState();
      setDraft(
        current.conditions.length > 0
          ? current
          : {
              match,
              conditions: [
                {
                  id: 'first',
                  field: builderFields[0]?.id ?? '',
                  operator: builderFields[0]?.operators[0]?.id ?? '',
                  values: [],
                },
              ],
            },
      );
    }
  }
  const setOpen = onOpenChange;
  const worked = metrics.filter((m) => m.filter).map((m) => m.label);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-170" sheetOnTouch={false}>
        <DialogHeader>
          <DialogTitle>Filter people</DialogTitle>
          <DialogDescription>
            Combine conditions on any column you can see. Nothing applies until you press Apply.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <Stack gap={4}>
            <FilterBuilder
              label="Conditions"
              fields={builderFields}
              value={draft}
              onChange={setDraft}
              maxConditions={20}
            />
            {worked.length === 0 ? null : (
              <Card variant="fill" padded className="text-sm text-fg-muted">
                Besides the columns you can filter on {worked.join(', ')}.
              </Card>
            )}
          </Stack>
        </DialogBody>
        <DialogFooter>
          <Button
            variant="ghost"
            className="me-auto"
            onClick={() => {
              setDraft({ match: 'all', conditions: [] });
            }}
          >
            Clear
          </Button>
          <Button
            onClick={() => {
              setOpen(false);
            }}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              onApply(
                complete.map((c) => ({ key: c.field, op: c.operator, values: c.values })),
                draft.match,
              );
              setOpen(false);
            }}
          >
            {complete.length === 0
              ? 'Show everybody'
              : `Apply ${String(complete.length)} ${complete.length === 1 ? 'condition' : 'conditions'}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
