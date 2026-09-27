import {
  Avatar,
  Badge,
  Button,
  Card,
  ColumnChooser,
  DataTable,
  EmptyState,
  FilterBuilder,
  ListDetail,
  PageHeader,
  SearchField,
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
  useBreakpoint,
  type ColumnChooserValue,
  type DataColumn,
  type DataTableSort,
  type FilterField,
  type FilterGroup,
  type FilterOperator,
} from '@reach/ui';
import { useEffect, useState, type JSX, type ReactNode } from 'react';

import { Loaded, type Loadable, type Outcome } from '../load';
import { longDate } from '../record/display';
import { MissingMark } from '../record/missing';
import { SaveSegment, SegmentSelect, type SegmentRef } from '../segments';

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
  readonly search: string;
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
  /** The saved segment applied, server-side: `?segment=<id>`. */
  readonly segmentId?: string | null;
  readonly onSegmentChange?: (segmentId: string | null) => void;
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
 * The directory (PRD §13.1, design screen 7).
 *
 * Columns come from the published schema rather than from this file, so a
 * field a tenant invented on Tuesday is a column and a filter by Wednesday.
 * Search, conditions, order and paging run where the rows are — the shell
 * passes them to People, a page of people at a time (PEO-117) — because
 * 50,000 rows do not travel to a browser to be searched. Completeness is a
 * count, not a percentage: "2 missing" is actionable and "94%" is not.
 */
export function Directory(props: DirectoryProps): JSX.Element {
  const { load } = props;
  const summary = load.status === 'ready' ? summaryOf(load.data) : undefined;

  return (
    <Stack gap={6}>
      <PageHeader
        title="Directory"
        description={summary}
        actions={
          <span className="flex gap-2">
            {props.onExport === undefined ? null : (
              <Button startIcon={<icons.download aria-hidden />} onClick={props.onExport}>
                Export
              </Button>
            )}
            {props.onImport === undefined ? null : (
              <Button startIcon={<icons.upload aria-hidden />} onClick={props.onImport}>
                Import
              </Button>
            )}
          </span>
        }
      />
      <Loaded load={load} what="the directory">
        {(state) => <Table {...props} state={state} />}
      </Loaded>
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

const STATUS_TONE: Record<string, 'success' | 'neutral' | 'warning' | 'info'> = {
  Active: 'success',
  'On leave': 'info',
  'On notice': 'warning',
  'Starting soon': 'info',
};

function Table({
  state,
  search,
  onSearchChange,
  filters,
  onFiltersChange,
  onConditionsChange,
  onSortChange,
  segmentId = null,
  onSegmentChange,
  onSaveSegment,
  onOpen,
  onImport,
  onBulkEdit,
  onNextPage,
  onFirstPage,
  onLoadMore,
  next = null,
  incomplete = false,
  onIncompleteChange,
}: DirectoryProps & { readonly state: DirectoryState }): JSX.Element {
  const wide = useBreakpoint('md');
  const columnsChosen = useColumns(state.columns);
  const widths = useWidths();
  const loaded = useRows(state.people, next, onLoadMore);
  const fields = state.fields ?? [];
  const conditions = state.query?.conditions ?? [];
  const match = state.query?.match === 'any' ? 'any' : 'all';
  const sort = state.query?.sort ?? null;
  const kindOf = new Map(fields.map((f) => [f.key, f.kind]));

  // Nobody at all, rather than nobody matching: say so, and where adding
  // happens. No buttons of its own: Import is in the header and Add employee
  // is People's manifest action beside every screen, and a second copy of
  // either on one screen is noise.
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
            : 'Add people one at a time with Add employee, or import a spreadsheet of everybody.'
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
          <Avatar size="xs" name={ref.name} src={ref.avatarUrl ?? undefined} />
          <span className="truncate">{ref.name}</span>
        </span>
      );
    }
    const value = p.values[c.key];
    if (value === undefined || value === '') return <span className="text-fg-subtle">—</span>;
    if (c.key === 'status') {
      return (
        <Badge size="sm" tone={STATUS_TONE[value] ?? 'neutral'}>
          {value}
        </Badge>
      );
    }
    if (kindOf.get(c.key) === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return <span className="whitespace-nowrap tabular-nums">{longDate(value)}</span>;
    }
    return value;
  };

  const byKey = new Map(state.columns.map((c) => [c.key, c]));
  const shown = columnsChosen.value.order.filter(
    (k) => k !== PERSON && columnsChosen.value.visible.includes(k) && byKey.has(k),
  );
  const columns: DataColumn<DirectoryPerson>[] = [
    {
      id: PERSON,
      header: 'Name',
      width: '17rem',
      sticky: true,
      sortBy: (p) => p.name,
      cell: (p) => (
        <span className="flex items-center gap-3">
          <Avatar size="sm" name={p.name} src={p.avatarUrl ?? undefined} />
          <span className="min-w-0">
            <span className="block truncate font-medium text-fg">{p.name}</span>
            {p.email === null ? null : (
              <span className="block truncate text-xs text-fg-muted">{p.email}</span>
            )}
          </span>
        </span>
      ),
    },
    ...shown.map((key): DataColumn<DirectoryPerson> => {
      const c = byKey.get(key) as DirectoryColumn;
      return {
        id: c.key,
        header: c.label,
        ...(c.sortable === false || onSortChange === undefined
          ? {}
          : { sortBy: (p: DirectoryPerson) => p.values[c.key] ?? '' }),
        cell: (p) => cell(p, c),
      };
    }),
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
  const chips: { key: string; text: string; remove: () => void }[] = [
    ...conditions.map((c, i) => ({
      key: `c${String(i)}`,
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
        text: `${f?.label ?? key}: ${f?.options.find((o) => o.value === value)?.label ?? value}`,
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

  return (
    <Stack gap={4}>
      <Toolbar
        search={<SearchField label="Search people" value={search} onValueChange={onSearchChange} />}
        filters={[
          onConditionsChange === undefined || fields.length === 0 ? null : (
            <Filters
              key="filters"
              fields={fields}
              conditions={conditions}
              match={match}
              onApply={onConditionsChange}
            />
          ),
          onSegmentChange === undefined ? null : (
            <SegmentSelect
              key="segment"
              segments={state.segments ?? []}
              value={segmentId}
              onChange={onSegmentChange}
            />
          ),
          // HR's: only the people with something missing (the verdict's, as HR may see it).
          state.incomplete === null || onIncompleteChange === undefined ? null : (
            <Select
              key="incomplete"
              value={incomplete ? 'missing' : ANY}
              onValueChange={(value) => {
                onIncompleteChange(value === 'missing');
              }}
            >
              <SelectTrigger aria-label="Record" className="w-auto min-w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Any record</SelectItem>
                <SelectItem value="missing">Missing information</SelectItem>
              </SelectContent>
            </Select>
          ),
        ]}
        actions={
          <span className="flex flex-wrap items-center gap-2">
            {onSaveSegment === undefined || Object.keys(filters).length === 0 ? null : (
              <SaveSegment onSave={onSaveSegment} />
            )}
            {wide ? (
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
            ) : null}
          </span>
        }
      />
      {chips.length === 0 ? null : (
        <div className="flex flex-wrap items-center gap-2" aria-label="Filters in force">
          {match === 'any' && conditions.length > 1 ? (
            <span className="text-xs text-fg-muted">Any of:</span>
          ) : null}
          {chips.map((chip) => (
            <Badge key={chip.key} onRemove={chip.remove} removeLabel={`Remove ${chip.text}`}>
              {chip.text}
            </Badge>
          ))}
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
        </div>
      )}
      {wide ? (
        <DataTable
          label="People"
          rows={loaded.rows}
          striped
          resizable
          columnWidths={widths.widths}
          onColumnWidthsChange={widths.choose}
          // Infinite: the table scrolls in a window of its own, the next page
          // loads near the end, and past 100 rows only what is on screen is
          // mounted (Reach's `auto`).
          estimateRowHeight={57}
          containerClassName="max-h-[calc(100dvh-16rem)] min-h-96"
          {...(loaded.loadMore === undefined ? {} : { onEndReached: loaded.loadMore })}
          columns={columns}
          rowId={(p) => p.id}
          describeRow={(p) => p.name}
          onRowClick={(p) => {
            onOpen(p.id);
          }}
          {...(onSortChange === undefined
            ? {}
            : {
                sort: tableSort,
                onSortChange: (next: DataTableSort | null) => {
                  onSortChange(
                    next === null
                      ? null
                      : {
                          key: next.columnId === PERSON ? 'name' : next.columnId,
                          direction: next.direction === 'ascending' ? 'asc' : 'desc',
                        },
                  );
                },
              })}
          {...(onBulkEdit === undefined
            ? {}
            : {
                selectable: true,
                bulkActions: (rows: DirectoryPerson[]) => (
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => {
                      onBulkEdit(rows.map((p) => p.id));
                    }}
                  >
                    Edit together
                  </Button>
                ),
              })}
          stickyHeader
          empty={
            <EmptyState
              title="Nobody matches"
              description="Remove a filter or change the search to see more people."
            />
          }
        />
      ) : (
        <Cards
          state={{ ...state, people: loaded.rows }}
          columns={shown.flatMap((k) => byKey.get(k) ?? [])}
          cell={cell}
          onOpen={onOpen}
        />
      )}
      {onLoadMore === undefined ? null : (
        <p role="status" className="text-xs text-fg-muted">
          {loaded.loading
            ? 'Loading more people…'
            : `Showing ${String(loaded.rows.length)} of ${String(state.total)}`}
        </p>
      )}
      {!wide && loaded.loadMore !== undefined ? (
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
      <Button
        startIcon={<icons.filter aria-hidden />}
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
        {conditions.length === 0 ? 'Filters' : `Filters (${String(conditions.length)})`}
      </Button>
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

/**
 * The directory on a phone (§17.2): a card per person carrying the two
 * columns that matter, the rest one tap away in the detail pane. The same
 * people, the same filters; only the layout differs, and `useBreakpoint`
 * decides — nothing asks what device this is.
 */
function Cards({
  state,
  columns,
  cell,
  onOpen,
}: {
  readonly state: DirectoryState;
  readonly columns: readonly DirectoryColumn[];
  readonly cell: (p: DirectoryPerson, c: DirectoryColumn) => ReactNode;
  readonly onOpen: (personId: string) => void;
}): JSX.Element {
  const [chosen, setChosen] = useState<string | null>(null);
  const person = state.people.find((p) => p.id === chosen) ?? null;
  const [first, second] = columns;

  if (state.people.length === 0) {
    return (
      <EmptyState
        title="Nobody matches"
        description="Remove a filter or change the search to see more people."
      />
    );
  }
  return (
    <ListDetail
      listLabel="People"
      detailLabel={person?.name ?? 'Person'}
      selected={person !== null}
      onBack={() => {
        setChosen(null);
      }}
      backLabel="All people"
      list={
        <ul className="flex flex-col gap-2">
          {state.people.map((p) => (
            <li key={p.id}>
              <Card className="flex items-center gap-3 p-3">
                <Avatar size="md" name={p.name} src={p.avatarUrl ?? undefined} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{p.name}</span>
                  <span className="block truncate text-xs text-fg-muted">
                    {[first, second]
                      .map((c) => (c === undefined ? undefined : p.values[c.key]))
                      .filter((v) => v !== undefined && v !== '')
                      .join(' · ')}
                  </span>
                </span>
                {p.missing === null || p.missing === 0 ? null : <MissingMark count={p.missing} />}
                <Button
                  size="sm"
                  aria-label={`Details for ${p.name}`}
                  onClick={() => {
                    setChosen(p.id);
                  }}
                >
                  Details
                </Button>
              </Card>
            </li>
          ))}
        </ul>
      }
      detail={
        person === null ? null : (
          <Stack gap={4} className="p-4">
            <dl className="grid gap-3">
              {columns.map((c) => (
                <div key={c.key}>
                  <dt className="text-xs text-fg-muted">{c.label}</dt>
                  <dd className="text-sm">{cell(person, c)}</dd>
                </div>
              ))}
            </dl>
            <div>
              <Button
                variant="primary"
                onClick={() => {
                  onOpen(person.id);
                }}
              >
                Open profile
              </Button>
            </div>
          </Stack>
        )
      }
    />
  );
}
