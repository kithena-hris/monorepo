import {
  Avatar,
  Badge,
  Button,
  Chip,
  ChipGroup,
  ChipGroupItem,
  ChipRow,
  ColumnChooser,
  DataTable,
  EmptyState,
  FilterBuilder,
  KeyValues,
  List,
  ListItem,
  PageHeader,
  PersonCard,
  QuickLook,
  SearchField,
  SegmentedControl,
  SegmentedControlItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  Stack,
  Toolbar,
  icons,
  isConditionComplete,
  useCoarsePointer,
  type ColumnChooserValue,
  type DataColumn,
  type DataTableSort,
  type FilterField,
  type FilterGroup,
  type FilterOperator,
} from '@reach/ui';
import { useEffect, useState, type JSX, type ReactNode } from 'react';

import { useTyped } from '../held';
import { Loaded, type Loadable, type Outcome } from '../load';
import { longDate } from '../record/display';
import { MissingMark } from '../record/missing';
import { SaveSegment, type SegmentRef } from '../segments';

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
  /** The conditions and order this page answers. */
  readonly query?: {
    readonly conditions: readonly DirectoryCondition[];
    /** all or any. */
    readonly match: string;
    readonly sort: DirectorySort | null;
  };
  readonly filterable: readonly DirectoryFilter[];
  readonly people: readonly DirectoryPerson[];
  /** The saved segments this viewer could apply here (PEO-068). */
  readonly segments?: readonly SegmentRef[];
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
}

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
 * The rows: the first page as the shell drew it, then each page after it as
 * the reader scrolls. A new query is a new first page, and starts again.
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
  useEffect(() => {
    setMore({ people: [], next });
  }, [first, next]);
  const loadMore =
    onLoadMore === undefined || more.next === null
      ? undefined
      : () => {
          if (loading || more.next === null) return;
          const after = more.next;
          setLoading(true);
          void onLoadMore(after).then((page) => {
            setLoading(false);
            if (page === null) return;
            setMore((m) =>
              m.next !== after
                ? m
                : { people: [...m.people, ...(page.people as DirectoryPerson[])], next: page.next },
            );
          });
        };
  return { rows: [...first, ...more.people], loading, loadMore, done: more.next === null };
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
  select: [{ id: 'in', label: 'is any of', value: 'options' }, ...EMPTY],
  status: [{ id: 'in', label: 'is any of', value: 'options' }],
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
  onSaveSegment,
  canSave,
}: {
  readonly state: DirectoryState;
  readonly conditions: readonly DirectoryCondition[];
  readonly segmentId: string | null;
  readonly incomplete: boolean;
  readonly onView?: DirectoryProps['onView'];
  readonly onSaveSegment?: DirectoryProps['onSaveSegment'];
  readonly canSave: boolean;
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
      on: segmentId === s.id,
      view: { conditions: [], incomplete: false, segmentId: s.id },
    })),
  ];
  if (onView === undefined || views.length < 2) {
    return canSave && onSaveSegment !== undefined ? <SaveSegment onSave={onSaveSegment} /> : null;
  }
  const active = views.find((v) => v.on)?.id ?? '';
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
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
            {v.label}
            {v.count === null ? null : (
              <span className="font-medium tabular-nums">{v.count.toLocaleString('en-GB')}</span>
            )}
          </ChipGroupItem>
        ))}
      </ChipGroup>
      {canSave && onSaveSegment !== undefined ? <SaveSegment onSave={onSaveSegment} /> : null}
    </div>
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
  onBulkEdit,
  onNextPage,
  onFirstPage,
  onLoadMore,
  view = 'list',
  next = null,
  group = null,
  onGroupChange,
  incomplete = false,
}: DirectoryProps & { readonly state: DirectoryState }): JSX.Element {
  const coarse = useCoarsePointer();
  const [typed, type] = useTyped(search, onSearchChange);
  const [peek, setPeek] = useState<string | null>(null);
  const columnsChosen = useColumns(state.columns);
  const widths = useWidths();
  const loaded = useRows(state.people, next, onLoadMore);
  const fields = state.fields ?? [];
  const conditions = state.query?.conditions ?? [];
  const match = state.query?.match === 'any' ? 'any' : 'all';
  const sort = state.query?.sort ?? null;
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
          onImport === undefined ? undefined : (
            <Button startIcon={<icons.import aria-hidden />} onClick={onImport}>
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
  const peeked = rows.find((p) => p.id === peek) ?? null;
  const move = (step: 1 | -1) => {
    const at = rows.findIndex((p) => p.id === peek);
    const to = rows[at + step];
    if (to === undefined) return;
    setPeek(to.id);
    document.getElementById(`person-${to.id}`)?.focus();
  };

  const nameCell = (p: DirectoryPerson): JSX.Element => (
    <span className="flex min-w-0 items-center gap-3">
      <Avatar size="md" name={p.name} src={p.avatarUrl ?? undefined} />
      <span className="min-w-0">
        {/*
          The name is the row's control: Space or a click opens the quick
          look, ↵ the full profile, and ↑ ↓ walk the people without leaving
          the list.
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
              onOpen(p.id);
            } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              const at = rows.findIndex((r) => r.id === p.id);
              const to = rows[at + (event.key === 'ArrowDown' ? 1 : -1)];
              if (to === undefined) return;
              if (peek !== null) setPeek(to.id);
              document.getElementById(`person-${to.id}`)?.focus();
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
      description="Remove a filter or change the search to see more people."
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
              onClick={(event) => {
                event.preventDefault();
                onOpen(p.id);
              }}
            >
              {p.name}
            </a>
          </ListItem>
        ))}
      </List>
    )
  ) : view === 'cards' ? (
    rows.length === 0 ? (
      empty
    ) : (
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,12.5rem),1fr))] gap-3.5">
        {rows.map((p) => (
          <li key={p.id} className="min-w-0">
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
      </ul>
    )
  ) : (
    <DataTable
      label="People"
      rows={rows}
      {...(grouping === null ? {} : { groupBy: groupOf })}
      resizable
      columnWidths={widths.widths}
      onColumnWidthsChange={widths.choose}
      activeRowId={peek}
      // Infinite: the table scrolls in a window of its own, the next page
      // loads near the end, and past 100 rows only what is on screen is
      // mounted (Reach's `auto`).
      estimateRowHeight={57}
      containerClassName="max-h-[calc(100dvh-18rem)] min-h-96"
      {...(loaded.loadMore === undefined ? {} : { onEndReached: loaded.loadMore })}
      columns={columns}
      rowId={(p) => p.id}
      describeRow={(p) => p.name}
      onRowClick={(p) => {
        setPeek(p.id);
      }}
      // From the keyboard: Enter or O to the profile, Space for the quick look.
      onRowOpen={(p) => {
        onOpen(p.id);
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
            bulkActions: (picked: DirectoryPerson[]) => (
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  onBulkEdit(picked.map((p) => p.id));
                }}
              >
                Edit together
              </Button>
            ),
          })}
      stickyHeader
      empty={empty}
    />
  );

  return (
    <Stack gap={4}>
      <Views
        state={state}
        conditions={conditions}
        segmentId={segmentId}
        incomplete={incomplete}
        {...(onView === undefined ? {} : { onView })}
        {...(onSaveSegment === undefined ? {} : { onSaveSegment })}
        canSave={Object.keys(filters).length > 0}
      />
      <Toolbar
        search={
          <SearchField
            label="Search people"
            placeholder="Search by name, email or employee number"
            size="sm"
            value={typed}
            onValueChange={type}
            containerClassName="w-full @3xl:w-90"
          />
        }
        filters={
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
              <Filters
                key="filters"
                fields={fields}
                conditions={conditions}
                match={match}
                onApply={onConditionsChange}
              />
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
          </ChipRow>
        }
        actions={
          coarse ? undefined : (
            <span className="flex flex-wrap items-center gap-2">
              {onGroupChange === undefined || groupable.length === 0 || view !== 'list' ? null : (
                <Select
                  value={grouping?.key ?? ANY}
                  onValueChange={(value) => {
                    onGroupChange(value === ANY ? null : value);
                  }}
                >
                  <SelectTrigger aria-label="Group by" size="sm" className="w-auto min-w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ANY}>No grouping</SelectItem>
                    {groupable.map((f) => (
                      <SelectItem key={f.key} value={f.key}>
                        Group by {f.label.toLowerCase()}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <ColumnChooser
                columns={[
                  { id: PERSON, label: 'Name', locked: true },
                  ...state.columns.map((c) => ({ id: c.key, label: c.label })),
                ]}
                value={columnsChosen.value}
                onChange={columnsChosen.choose}
                onReset={() => {
                  columnsChosen.choose(null);
                }}
              />
              {onExport === undefined ? null : (
                <Button size="sm" startIcon={<icons.download aria-hidden />} onClick={onExport}>
                  Export
                </Button>
              )}
            </span>
          )
        }
      />
      {peeked !== null && view === 'list' && !coarse ? (
        <div className="grid grid-cols-[minmax(0,1fr)_21.25rem] items-start gap-4">
          {table}
          <QuickLook
            className="sticky top-4"
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
              move(-1);
            }}
            onNext={() => {
              move(1);
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
                  Profile
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
          </QuickLook>
        </div>
      ) : (
        table
      )}
      {onLoadMore === undefined ? null : (
        <p role="status" className="text-xs text-fg-muted">
          {loaded.loading
            ? 'Loading more people…'
            : `Showing ${String(rows.length)} of ${String(state.total)}`}
        </p>
      )}
      {(coarse || view === 'cards') && loaded.loadMore !== undefined ? (
        <div>
          <Button loading={loaded.loading} loadingLabel="Loading more" onClick={loaded.loadMore}>
            Show more people
          </Button>
        </div>
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
 * The advanced filters: conditions, one per row, all or any of them, in a
 * side panel so the table keeps the page. Nothing applies until Apply, so a
 * half-written condition never sends 50,000 people back to be counted.
 */
function Filters({
  fields,
  conditions,
  match,
  onApply,
}: {
  readonly fields: readonly DirectoryField[];
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
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<FilterGroup>(fromState);
  const complete = draft.conditions.filter((c) => isConditionComplete(builderFields, c));

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <Chip
        variant={conditions.length === 0 ? 'dashed' : 'filled'}
        startIcon={<icons.add aria-hidden />}
        onClick={() => {
          const current = fromState();
          // Opened with nothing yet: one empty row to start from.
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
          setOpen(true);
        }}
      >
        {conditions.length === 0 ? 'Add filter' : `Filters (${String(conditions.length)})`}
      </Chip>
      <SheetContent side="right" size="lg">
        <SheetHeader>
          <SheetTitle>Filter people</SheetTitle>
          <SheetDescription>
            Combine conditions on any column you can see. Dates, choices and text each offer what
            fits them.
          </SheetDescription>
        </SheetHeader>
        <SheetBody>
          <FilterBuilder
            label="Conditions"
            fields={builderFields}
            value={draft}
            onChange={setDraft}
            maxConditions={20}
          />
        </SheetBody>
        <SheetFooter>
          <Button
            variant="ghost"
            onClick={() => {
              setDraft({ match: 'all', conditions: [] });
            }}
          >
            Clear
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
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
