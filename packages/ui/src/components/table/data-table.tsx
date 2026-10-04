'use client';

import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type JSX,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
} from '@dnd-kit/core';
import { restrictToParentElement, restrictToVerticalAxis } from '@dnd-kit/modifiers';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  columnGroupingFeature,
  createCoreRowModel,
  createExpandedRowModel,
  createGroupedRowModel,
  createSortedRowModel,
  rowExpandingFeature,
  rowSelectionFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_basic,
  tableFeatures,
  useTable,
  type ColumnDef,
  type ExpandedState,
  type RowSelectionState,
  type Row,
  type RowData,
  type SortingState,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowUpDown, ChevronRight, GripVertical, X } from 'lucide-react';

import { bulkBarClass } from '../../lib/bulk-bar';
import { PINNED_BAR } from '../../lib/pinned';
import { cn } from '../../lib/cn';
import {
  actionPressed,
  pressed,
  sequenceArmed,
  useShortcutKeys,
  type RowAction,
} from '../../lib/shortcut-keys';
import { Button } from '../button/button';
import { Checkbox } from '../checkbox/checkbox';
import { Skeleton } from '../feedback/feedback';
import { RowMenu } from './row-menu';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  type SortDirection,
} from './table';

/**
 * The table, with everything a table is asked for.
 *
 * Sorting, selection with bulk actions, expandable detail rows and drag
 * reordering are the same four requests on every screen that has a list on it,
 * and building them four times produces four subtly different keyboard
 * behaviours. They compose here instead: each is a prop, each is off by
 * default, and each is built from the same `Table` primitives a hand-rolled
 * table would use, so a caller can still drop to those for anything unusual.
 *
 * ### It is one table, not four components
 *
 * The alternative (`SortableTable`, `SelectableTable`, `ExpandableTable`) falls
 * apart the first time somebody needs two of them, which is immediately.
 *
 * ### Detail rows stay inside the table
 *
 * A `<tr>` with a spanning cell, not a `<div>` grafted underneath. That keeps
 * the column relationships for a screen reader, keeps keyboard order in step
 * with reading order, and keeps the whole thing printable.
 *
 * ### Sorting and manual order are mutually exclusive
 *
 * A dragged row means nothing in a sorted table, because the next sort throws
 * it away.
 * The handles disable themselves while a sort is active, and say so, rather
 * than accepting a gesture whose result will not survive.
 *
 * ### Under a finger it is a list of cards
 *
 * The first column becomes the card's title and the rest wrap underneath it,
 * each prefixed with its `shortHeader` when there is one. It is the same
 * `<table>` restyled, not a second tree, so the row, cell and header
 * associations a screen reader relies on survive, and so do selection,
 * expansion and the drag handles. Sortable headers become a row of chips above
 * the cards, and "Select all" gets a visible label.
 *
 * It keys on the pointer (`touch:`), never the viewport: a phone-sized window
 * on a desk still has a mouse and still wants columns.
 *
 * ### It moves from the keyboard
 *
 * A table whose rows do something (open, select, preview, act) is a grid with
 * a roving row focus: Tab reaches one row, and from it J and K or ↓ and ↑ move
 * the focus, Home and End jump, Enter or O opens (`onRowClick`), X selects,
 * ⇧J and ⇧K (or ⇧↓ ⇧↑) extend the selection, Space previews
 * (`onRowPreview`), a `rowActions` key runs that action, and Escape clears
 * the selection, then leaves the row. The letters are the app's to change
 * (`setShortcutKeys`) and go quiet when it turns character keys off; the
 * arrows, Enter and Escape always work. A screen reader hears a grid, the row
 * it is on, and whether the row is selected.
 */

/*
 * The card layout, one class list per part, so the `<table>` markup below stays
 * one tree. `!` because the desk layout pads cells with `first:` and `last:`,
 * which outrank a plain variant.
 */
const CARD = {
  table: 'touch:block',
  section: 'touch:block',
  /*
   * The header's cells stop being sticky one by one; the header as a whole
   * sticks instead, opaque, over the cards.
   */
  head: 'touch:block touch:[&_th]:static! touch:[&_th]:bg-transparent! touch:[&_th]:shadow-none! touch:[[data-sticky-header]_&]:sticky touch:[[data-sticky-header]_&]:top-0 touch:[[data-sticky-header]_&]:z-20 touch:[[data-sticky-header]_&]:bg-surface',
  headRow: 'touch:flex touch:flex-wrap touch:items-center touch:gap-2 touch:px-4 touch:py-2.5',
  row: 'touch:relative touch:flex touch:flex-wrap touch:items-center touch:gap-x-3.5 touch:gap-y-1 touch:py-3.5 touch:pe-4',
  /** Start padding clearing 0, 1 or 2 leading controls (grip, checkbox). */
  rowStart: ['touch:ps-4', 'touch:ps-15', 'touch:ps-26'],
  lead: ['touch:start-4', 'touch:start-15'],
  leadCell: 'touch:absolute touch:top-1.5 touch:h-auto! touch:w-auto! touch:p-0!',
  cell: 'touch:block touch:h-auto! touch:p-0!',
  title: 'touch:basis-full touch:text-base touch:font-semibold',
  /** The title when a `cardTrailing` value shares its line. */
  titleBeside: 'touch:min-w-0 touch:flex-1 touch:basis-0',
  /*
   * Ends the title line when a `cardTrailing` value shares it, so the details
   * wrap below both. A pseudo-element of a flex row is a flex item, and unlike
   * an extra cell it does not move the row's `last:` padding.
   */
  titleBreak:
    "touch:after:order-2 touch:after:block touch:after:basis-full touch:after:content-['']",
  /** A `cardTrailing` value: the end of the title line, in full ink. */
  trailing:
    'touch:order-1 touch:shrink-0 touch:text-right touch:text-sm touch:font-semibold touch:text-fg touch:tabular-nums',
  meta: 'touch:static touch:order-3 touch:text-left touch:text-sm touch:text-fg-muted',
  /** The `shortHeader` in front of a value, only on a cell that has one. */
  label: 'touch:before:me-1.5 touch:before:text-fg-subtle touch:before:content-[attr(data-label)]',
} as const;

/**
 * The feature set this table opts into, declared once.
 *
 * TanStack Table v9 is modular: a feature that is not named here is not in the
 * bundle and its options do not typecheck. Sorting (one column or several),
 * selection, expansion and grouping are what this component exposes, so they
 * are what is listed. Column widths are the component's own, controlled like
 * the rest of its state. Filtering, pagination and pinning are
 * deliberately absent, and adding one is a decision made here rather than a
 * prop appearing by accident.
 *
 * Only two sort functions are registered for the same reason: importing the
 * `sortFns` bundle would pull every built-in comparator into every application
 * that renders a table.
 */
/**
 * What TanStack is willing to accept as a row: its own `RowData`, which is
 * `Record<string, any> | Array<any>`. Using the library's own alias rather than
 * a narrower one of ours keeps the column definitions assignable.
 */
type TableRow = RowData;

const FEATURES = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric, basic: sortFn_basic },
  rowSelectionFeature,
  rowExpandingFeature,
  expandedRowModel: createExpandedRowModel(),
  columnGroupingFeature,
  groupedRowModel: createGroupedRowModel(),
  coreRowModel: createCoreRowModel(),
});

/** A striped row: the sunken fill at 60%, mixed solid so a sticky cell can inherit it. */
const STRIPE =
  'bg-[color-mix(in_oklch,var(--reach-color-surface-sunken)_60%,var(--reach-color-surface))]';

/** The column TanStack groups on. Never rendered: the group header row shows its value. */
const GROUP_COLUMN = '__group';

/** A column's narrowest and widest, in px, and its width when it names none. */
const COLUMN_MIN = 64;
const COLUMN_MAX = 960;
const COLUMN_DEFAULT = 176;
/** How near the end, in px, counts as the end. */
const END_MARGIN = 480;

const clampWidth = (w: number): number => Math.min(COLUMN_MAX, Math.max(COLUMN_MIN, Math.round(w)));

/** `'10rem'` or `'160px'` as px; anything else is the default. */
function widthOf(width: string | undefined): number {
  const m = /^([\d.]+)(rem|px)$/.exec(width ?? '');
  if (m === null) return COLUMN_DEFAULT;
  return clampWidth(Number(m[1]) * (m[2] === 'rem' ? 16 : 1));
}

/**
 * The spare width of a table narrower than its container, given only to the
 * columns whose cells overflow, and never more than each one needs. With no
 * spare, or nothing overflowing, nothing moves. Pure, for its test.
 */
export function stretchOverflowing(
  spare: number,
  overflow: Readonly<Record<string, number>>,
): Record<string, number> {
  const total = Object.values(overflow).reduce((n, v) => n + Math.max(0, v), 0);
  if (spare <= 0 || total <= 0) return {};
  const share = Math.min(1, spare / total);
  return Object.fromEntries(
    Object.entries(overflow)
      .filter(([, v]) => v > 0)
      .map(([id, v]) => [id, Math.floor(v * share)]),
  );
}

/** The column named in a sort label: its header if that is text, else its short header. */
function columnName<T>(column: DataColumn<T>): string {
  return typeof column.header === 'string' ? column.header : (column.shortHeader ?? column.id);
}

/**
 * "Team, then start date". Exported for its test: the label is what a phone
 * shows instead of the header row, so its wording is the sort's only readout.
 */
export function describeSorts<T>(
  sorts: readonly DataTableSort[],
  columns: readonly DataColumn<T>[],
): string {
  return sorts
    .map((sort, index) => {
      const column = columns.find((candidate) => candidate.id === sort.columnId);
      const name = column ? columnName(column) : sort.columnId;
      return index === 0 ? name : name.toLowerCase();
    })
    .join(', then ');
}

function toSortList(
  sort: DataTableSort | readonly DataTableSort[] | null | undefined,
): readonly DataTableSort[] {
  if (sort === null || sort === undefined) return [];
  return 'columnId' in sort ? [sort] : sort;
}

export interface DataColumn<T> {
  /** Stable id. Used for the sort state and as the React key. */
  id: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** Right-align with tabular figures. For money, counts and dates. */
  numeric?: boolean;
  /** Fixed width, e.g. `'10rem'`. */
  width?: string;
  /** Pins the column during horizontal scroll. Use it for the identity column. */
  sticky?: boolean;
  /**
   * Left off the card a row becomes under a finger. For a column that only
   * makes sense compared down the table, not read one record at a time.
   */
  hideOnCard?: boolean;
  /** Makes the column sortable. Return the value to compare on. */
  sortBy?: (row: T) => string | number;
  /** A short label for the column, used in the stacked readout on narrow screens. */
  shortHeader?: string;
  /**
   * Under a finger, the value sits at the end of the card's title line rather
   * than among the details underneath. For the one figure a row is compared
   * on: a salary, a balance, a count. At most one column.
   */
  cardTrailing?: boolean;
  /**
   * The value shown for this column on a group's header row when the table is
   * grouped: a sum, a count, a range. Given the group's rows; formatting is
   * the caller's, so money stays exact.
   */
  aggregate?: (rows: readonly T[]) => ReactNode;
  className?: string;
}

export interface DataTableSort {
  columnId: string;
  direction: Exclude<SortDirection, null>;
}

export interface DataTableReorder {
  id: string;
  from: number;
  to: number;
  /** The ids in their new order. */
  order: readonly string[];
}

/** What a caller can ask of the table from outside it, through `ref`. */
export interface DataTableHandle {
  /**
   * Brings a row into view: smoothly, unless the reader asked for reduced
   * motion, and not at all when it is already in full view. A virtualized row
   * is mounted on the way. With `focus`, the keyboard lands on it too.
   */
  revealRow: (id: string, options?: { readonly focus?: boolean }) => void;
}

export interface DataTableProps<T extends TableRow> {
  ref?: Ref<DataTableHandle>;
  rows: readonly T[];
  columns: readonly DataColumn<T>[];
  /** Stable identity. An index stops being identity the moment anything sorts. */
  rowId: (row: T) => string;
  /** Names the table for assistive tech. */
  label: string;
  /** A visible caption under the table. */
  caption?: ReactNode;

  /** Detail for one row. Return `null` for a row with nothing more to say. */
  renderDetail?: (row: T) => ReactNode;
  expanded?: readonly string[];
  onExpandedChange?: (expanded: readonly string[]) => void;
  defaultExpanded?: readonly string[];
  /** Only one detail row open at a time. */
  singleExpand?: boolean;

  /** Row checkboxes, a select-all, and the bulk bar. */
  selectable?: boolean;
  selected?: readonly string[];
  onSelectedChange?: (selected: readonly string[]) => void;
  defaultSelected?: readonly string[];
  /** The actions offered for the current selection. Rendered in the bulk bar. */
  bulkActions?: (rows: T[]) => ReactNode;

  /**
   * Current sort. Uncontrolled, and sorted for you, when omitted. A list is a
   * multi-column sort, most significant first.
   */
  sort?: DataTableSort | readonly DataTableSort[] | null;
  /** Fires with the primary sort. `onSortsChange` has the whole list. */
  onSortChange?: (sort: DataTableSort | null) => void;
  onSortsChange?: (sorts: readonly DataTableSort[]) => void;
  defaultSort?: DataTableSort | readonly DataTableSort[] | null;
  /**
   * Shift-click adds a column to the sort instead of replacing it. Headers
   * then carry their position in the order as a small number.
   */
  multiSort?: boolean;

  /**
   * Groups the rows by the value this returns, under a header row per group
   * that collapses, counts its rows and shows each column's `aggregate`. The
   * value need not be a column. Groups come in the order their first row
   * does, so a table that pages should have its rows arrive in group order
   * (sort by the same thing, on the server), and a count is of the rows
   * loaded. Headings are rows of their own, `rowgroup` headers, virtualized
   * with the rest. Keep the function stable (module scope or `useCallback`);
   * rows cannot be dragged while grouped.
   */
  groupBy?: (row: T) => string;
  /** Groups, by value, that start collapsed. */
  defaultCollapsedGroups?: readonly string[];

  /**
   * Every other row washed, so a wide row can be followed across by eye.
   * Counted on the row's position, not the DOM's, so a virtualized body keeps
   * the rhythm as rows come and go. Never over a selection.
   */
  striped?: boolean;
  /**
   * A drag handle on every header's right edge, and the arrow keys on it
   * (Shift for bigger steps), to widen a column and read what it truncates.
   * The table lays out on the widths, so a cell ellipsizes rather than
   * pushing its neighbours.
   */
  resizable?: boolean;
  /**
   * How the columns get their widths. `content` (the default without
   * `resizable`) is the browser's table layout: each column as wide as what
   * it holds. `fixed` (the default with it) lays out on the declared widths,
   * gives spare room once to the columns the first rows overflow, and never
   * moves them again: rows arriving or scrolling past cannot nudge a column,
   * which is what a table that keeps loading needs.
   */
  columnSizing?: 'content' | 'fixed';
  /** Widths in px by column id. Uncontrolled when omitted. */
  columnWidths?: Readonly<Record<string, number>>;
  onColumnWidthsChange?: (widths: Readonly<Record<string, number>>) => void;
  /**
   * Called when the reader scrolls near the end: fetch the next page and
   * append it. Only a table whose container has a height of its own scrolls,
   * so pass one through `containerClassName`. It is not called while
   * `loadingMore` is set; without that, it can fire again before rows
   * arrive, so guard it.
   */
  onEndReached?: () => void;
  /** The next page is on its way: a skeleton row, in the rows' shape, sits under the last one. */
  loadingMore?: boolean;

  /** Drag handles on every row. Disabled while a sort is active. */
  reorderable?: boolean;
  onReorder?: (move: DataTableReorder) => void;

  /** A word for what a row is, used in every generated control name. */
  describeRow?: (row: T) => string;
  /** A click on the row; also Enter or O, unless `onRowOpen` says otherwise. */
  onRowClick?: (row: T) => void;
  /**
   * Enter or O on the focused row, where opening differs from a click: a
   * click previews, Enter goes to the record.
   */
  onRowOpen?: (row: T) => void;
  /** Space on the focused row: a quick look at it, without leaving the list. */
  onRowPreview?: (row: T) => void;
  /**
   * What can be done to one row: a menu at the row's end listing each with its
   * keys, which also run it while the row has focus. A destructive one
   * confirms in its own `onSelect`.
   */
  rowActions?: (row: T) => readonly RowAction[];
  /**
   * Under a finger, keep the row menu on each card, at the end of its title
   * line. Off by default: a card is usually its own way in, and its actions
   * live on what it opens. On when the actions are the only way to them.
   */
  rowMenuOnCard?: boolean;
  /**
   * The row whose record is open beside the table, in a quick look or a
   * detail pane: marked with the accent edge and `aria-current`, so the
   * reader keeps their place while the pane changes.
   */
  activeRowId?: string | null;
  /** Shown in place of the body when there are no rows. */
  empty?: ReactNode;
  stickyHeader?: boolean;
  /** Shorter rows and smaller type. Has no effect on the cards under a finger. */
  dense?: boolean;
  containerClassName?: string;
  className?: string;

  /**
   * Render only the rows on screen.
   *
   * Off, on, or `'auto'` (the default), which turns itself on past
   * `virtualizeThreshold` rows. Ignored while rows are reorderable: dnd-kit
   * resolves a drop against mounted nodes, so an unmounted row is not a drop
   * target and dragging to the end of a long list would silently do nothing.
   *
   * A virtualized table sets `aria-rowcount` and `aria-rowindex`, because
   * otherwise a screen reader announces the handful of rows that happen to be
   * mounted as though they were the whole table.
   */
  virtualize?: boolean | 'auto';
  /** Row count past which `'auto'` starts virtualizing. */
  virtualizeThreshold?: number;
  /**
   * A row's height in px: a virtualized desk row is drawn exactly this tall,
   * and the rows not yet drawn are counted at it. The default is a row of the
   * table's density, a `TableCell` and its hairline.
   */
  estimateRowHeight?: number;
}

export function DataTable<T extends TableRow>({
  ref,
  rows,
  columns,
  rowId,
  label,
  caption,
  renderDetail,
  expanded,
  onExpandedChange,
  defaultExpanded,
  singleExpand = false,
  selectable = false,
  selected,
  onSelectedChange,
  defaultSelected,
  bulkActions,
  sort,
  onSortChange,
  onSortsChange,
  defaultSort = null,
  multiSort = false,
  groupBy,
  defaultCollapsedGroups,
  striped = false,
  resizable = false,
  columnSizing = resizable ? 'fixed' : 'content',
  columnWidths,
  onColumnWidthsChange,
  onEndReached,
  loadingMore = false,
  reorderable = false,
  onReorder,
  describeRow,
  onRowClick,
  onRowOpen = onRowClick,
  onRowPreview,
  rowActions,
  rowMenuOnCard = false,
  activeRowId = null,
  empty = 'Nothing to show.',
  stickyHeader = false,
  dense = false,
  containerClassName,
  className,
  virtualize = 'auto',
  virtualizeThreshold = 100,
  estimateRowHeight = dense ? 41 : 57,
}: DataTableProps<T>): JSX.Element {
  const base = useId();
  const [openRows, setOpenRows] = useState<readonly string[]>(defaultExpanded ?? []);
  const [pickedRows, setPickedRows] = useState<readonly string[]>(defaultSelected ?? []);
  const [ownSorts, setOwnSorts] = useState<readonly DataTableSort[]>(() => toSortList(defaultSort));
  const [collapsed, setCollapsed] = useState<readonly string[]>(defaultCollapsedGroups ?? []);
  const [ownWidths, setOwnWidths] = useState<Readonly<Record<string, number>>>({});
  const widths = columnWidths ?? ownWidths;
  const fixed = columnSizing === 'fixed';
  // Width a column was given to show what it truncates (`stretchOverflowing`),
  // measured once per set of columns: measuring again as rows arrive, as the
  // container gained a scrollbar or as a column was dragged moved every
  // column under the reader's eye.
  const fitKey = columns.map((c) => c.id).join('|');
  const [fit, setFit] = useState<{
    readonly key: string;
    readonly extra: Readonly<Record<string, number>>;
  }>({ key: '', extra: {} });
  const fitted = fit.key === fitKey ? fit.extra : {};
  const widthFor = (column: DataColumn<T>): number =>
    widths[column.id] ?? widthOf(column.width) + (fitted[column.id] ?? 0);
  const setWidth = (id: string, width: number): void => {
    const next = { ...widths, [id]: clampWidth(width) };
    if (columnWidths === undefined) setOwnWidths(next);
    onColumnWidthsChange?.(next);
  };

  const open = new Set(expanded ?? openRows);
  const picked = new Set(selected ?? pickedRows);
  const activeSorts = sort === undefined ? ownSorts : toSortList(sort);

  const setOpen = (next: readonly string[]): void => {
    if (expanded === undefined) setOpenRows(next);
    onExpandedChange?.(next);
  };
  const setPicked = (next: readonly string[]): void => {
    if (selected === undefined) setPickedRows(next);
    onSelectedChange?.(next);
  };
  const setSorts = (next: readonly DataTableSort[]): void => {
    if (sort === undefined) setOwnSorts(next);
    onSortChange?.(next[0] ?? null);
    onSortsChange?.(next);
  };

  /*
   * The row model comes from TanStack Table.
   *
   * The public API here stays value-shaped: a column declares `sortBy(row)`
   * rather than an accessor and a comparator, because that is the only thing
   * callers ever needed. It is mapped onto an accessor below, so the sorting,
   * selection and expansion are the library's rather than three hand-written
   * implementations that drift apart.
   *
   * `manualSorting` follows the controlled prop. When a caller owns `sort`, the
   * rows arrive in the order they decided, which is what server-side sorting
   * looks like, and re-sorting them here would silently undo it.
   */
  /*
   * `T extends TableRow` rather than an unconstrained `T` whose rows are
   * carried internally as `TableRow` and handed back with an assertion.
   *
   * The constraint is `Record<string, any> | Array<any>`, which every table row
   * already satisfies, a row is an object, so it costs callers nothing and no
   * domain type has to be widened to meet it. What it buys is that the generic
   * threads all the way through TanStack instead of being erased at the
   * boundary and re-asserted at each of the six points a row came back out.
   * Those assertions were each individually true and collectively load-bearing:
   * nothing checked that the `T` going in matched the `T` coming out.
   */
  const tableColumns = useMemo<ColumnDef<typeof FEATURES, T>[]>(
    () =>
      columns
        .map((column): ColumnDef<typeof FEATURES, T> => ({
          id: column.id,
          // A column with no `sortBy` is not sortable, and an accessor returning
          // the row itself would sort by object identity.
          accessorFn: column.sortBy ? (row: T) => column.sortBy?.(row) ?? null : () => null,
          enableSorting: column.sortBy !== undefined,
          enableMultiSort: multiSort,
          enableGrouping: false,
          sortFn: 'alphanumeric',
        }))
        .concat(
          groupBy === undefined
            ? []
            : [
                {
                  id: GROUP_COLUMN,
                  accessorFn: groupBy,
                  enableSorting: false,
                  enableGrouping: true,
                },
              ],
        ),
    [columns, groupBy, multiSort],
  );

  const sorting: SortingState = useMemo(
    () =>
      activeSorts.map((entry) => ({ id: entry.columnId, desc: entry.direction === 'descending' })),
    [activeSorts],
  );

  const rowSelection: RowSelectionState = useMemo(
    () => Object.fromEntries([...picked].map((id) => [id, true])),
    [picked],
  );

  const expandedState: ExpandedState = useMemo(
    () => Object.fromEntries([...open].map((id) => [id, true])),
    [open],
  );

  /*
   * TanStack wants a mutable `T[]` and the prop is a `readonly T[]`, which is
   * the right shape for a prop. Copying is what makes the two compatible
   * without asserting the readonly away, and it is memoised so the table does
   * not see a new identity every render.
   */
  const dataRows = useMemo(() => [...rows], [rows]);

  const table = useTable<typeof FEATURES, T>({
    features: FEATURES,
    data: dataRows,
    columns: tableColumns,
    getRowId: (row) => rowId(row),
    manualSorting: sort !== undefined,
    enableRowSelection: selectable,
    enableMultiSort: multiSort,
    // Group rows keep their columns where they were; the grouped value is the
    // header row's label, not a column that jumps to the front.
    groupedColumnMode: false,
    state: {
      sorting,
      rowSelection,
      grouping: groupBy === undefined ? [] : [GROUP_COLUMN],
      // Every group is expanded as far as TanStack is concerned; collapsing
      // hides a group's rows below, so a collapsed group keeps its count and
      // its sums. A leaf row has no sub-rows, so detail rows are unaffected.
      expanded: groupBy === undefined ? expandedState : true,
    },
    onSortingChange: (updater) => {
      const next = typeof updater === 'function' ? updater(sorting) : updater;
      setSorts(
        next.map((entry) => ({
          columnId: entry.id,
          direction: entry.desc ? 'descending' : 'ascending',
        })),
      );
    },
    onRowSelectionChange: (updater) => {
      const next = typeof updater === 'function' ? updater(rowSelection) : updater;
      setPicked(Object.keys(next).filter((id) => next[id]));
    },
  });

  /*
   * What the body draws, in order: a header per group and the rows under it,
   * or just the rows. A collapsed group keeps its header and drops its rows.
   */
  const shut = new Set(collapsed);
  const items: ({ kind: 'group'; row: Row<typeof FEATURES, T> } | { kind: 'row'; row: T })[] = [];
  for (const row of table.getRowModel().rows) {
    if (row.getIsGrouped()) items.push({ kind: 'group', row });
    else if (!(row.parentId && shut.has(String(table.getRow(row.parentId).groupingValue))))
      items.push({ kind: 'row', row: row.original });
  }
  const ordered = table
    .getRowModel()
    .rows.filter((row) => !row.getIsGrouped())
    .map((row) => row.original);
  const ids = ordered.map((row) => rowId(row));
  // A row's place among the rows, which is what a stripe counts: a group
  // header between two rows is not a row.
  const place = new Map(ids.map((id, index) => [id, index]));
  const allPicked = ids.length > 0 && ids.every((id) => picked.has(id));
  const somePicked = ids.some((id) => picked.has(id));
  const pickedRowObjects = ordered.filter((row) => picked.has(rowId(row)));

  // A dragged row means nothing in a sorted or grouped table: the next sort
  // discards it, and a group has its own order.
  const canReorder = reorderable && activeSorts.length === 0 && groupBy === undefined;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up row ${String(ids.indexOf(String(active.id)) + 1)}.`,
    onDragOver: ({ over }) =>
      over ? `Now over position ${String(ids.indexOf(String(over.id)) + 1)}.` : undefined,
    onDragEnd: ({ over }) =>
      over ? `Dropped at position ${String(ids.indexOf(String(over.id)) + 1)}.` : 'Dropped.',
    onDragCancel: () => 'Move cancelled. The order is unchanged.',
  };

  /*
   * Virtualization.
   *
   * Never while `canReorder`: dnd-kit resolves a drop against mounted nodes, so
   * a row scrolled out of the DOM stops being a drop target and a drag to the
   * far end of the list quietly does nothing. Expanded detail rows are the
   * other exclusion, since their height is arbitrary and measuring one costs
   * more than rendering the rows it would have saved.
   */
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // A table that keeps loading will pass the threshold mid-scroll, and turning
  // virtualization on then remounts the rows on screen: it starts on instead.
  const wantsVirtual =
    virtualize === 'auto'
      ? items.length >= virtualizeThreshold || onEndReached !== undefined
      : virtualize;
  const virtualized = wantsVirtual && !canReorder && renderDetail === undefined;

  // Memoised for the reason spelled out in `virtual-list.tsx`: a fresh arrow
  // each render reads as a changed configuration, and the recomputation that
  // follows is paid on every scroll frame.
  const getScrollElement = useCallback(() => scrollRef.current, []);
  const estimateSize = useCallback(() => estimateRowHeight, [estimateRowHeight]);

  const virtualizer = useVirtualizer({
    count: virtualized ? items.length : 0,
    getScrollElement,
    estimateSize,
    // Rows above and below the view: a screen's worth and more, so a fling
    // mostly lands on rows already drawn. Where it outruns them, the spacers
    // are skeleton rows (`SpacerRow`), never blank.
    overscan: 20,
  });

  // The pinned header's height: with every row counted at its height, the
  // box's whole extent, which `Table` holds the box to (`contentHeight`).
  const [headHeight, setHeadHeight] = useState(0);
  useLayoutEffect(() => {
    if (virtualized) setHeadHeight(scrollRef.current?.querySelector('thead')?.offsetHeight ?? 0);
  }, [virtualized, fitKey, dense]);

  const virtualRows = virtualized ? virtualizer.getVirtualItems() : [];
  const paddingTop = virtualRows.length > 0 ? (virtualRows[0]?.start ?? 0) : 0;
  // Until the virtualizer has measured its box it names no rows at all: the
  // body is then one skeleton as tall as every row, not an empty table, which
  // flashed blank and read as "at the end" to `onEndReached`, loading pages
  // nobody had scrolled to.
  const paddingBottom =
    virtualRows.length > 0
      ? virtualizer.getTotalSize() - (virtualRows[virtualRows.length - 1]?.end ?? 0)
      : virtualizer.getTotalSize();

  /** The items to render, paired with the 0-based index a reader should hear. */
  const visible: { item: (typeof items)[number]; index: number }[] = virtualized
    ? /*
       * `flatMap` with a presence check, not an index lookup asserted to be
       * populated. The virtualizer reports indices from the measurement it last
       * took, so for one render after the row count shrinks, a filter clearing,
       * a page shrinking, it can name an index that no longer exists. The old
       * assertion turned that into an `undefined` row handed to a cell renderer;
       * this drops it instead.
       */
      virtualRows.flatMap((virtual) => {
        const item = items[virtual.index];
        return item === undefined ? [] : [{ item, index: virtual.index }];
      })
    : items.map((item, index) => ({ item, index }));

  const leadingColumns = (renderDetail ? 1 : 0) + (selectable ? 1 : 0) + (canReorder ? 1 : 0);
  const totalColumns = columns.length + leadingColumns + (rowActions ? 1 : 0);

  /*
   * The keyboard. A roving row focus: one row is in the tab order (the last
   * one focused, else the first), and the keys move it. Only a table whose
   * rows do something takes it; a table to read keeps its plain semantics.
   */
  const keys = useShortcutKeys();
  const moves =
    onRowOpen !== undefined || selectable || rowActions !== undefined || onRowPreview !== undefined;
  const [focusId, setFocusId] = useState<string | null>(null);
  const tabbableId = focusId !== null && place.has(focusId) ? focusId : (ids[0] ?? null);
  // Where a ⇧J run started, and what was selected before it: moving back
  // over the run deselects what it selected, and nothing else.
  const anchor = useRef<{ id: string; base: readonly string[] } | null>(null);
  const focusRow = (id: string): void => {
    setFocusId(id);
    if (virtualized) {
      const at = items.findIndex((item) => item.kind === 'row' && rowId(item.row) === id);
      if (at >= 0) virtualizer.scrollToIndex(at);
    }
    requestAnimationFrame(() => {
      const row = [
        ...(scrollRef.current?.querySelectorAll<HTMLTableRowElement>('tr[data-row-id]') ?? []),
      ].find((el) => el.dataset['rowId'] === id);
      row?.focus();
    });
  };
  const rowElement = (id: string): HTMLTableRowElement | undefined =>
    [...(scrollRef.current?.querySelectorAll<HTMLTableRowElement>('tr[data-row-id]') ?? [])].find(
      (el) => el.dataset['rowId'] === id,
    );
  useImperativeHandle(ref, () => ({
    revealRow: (id, { focus = false } = {}) => {
      const box = scrollRef.current;
      if (box === null) return;
      const behavior: ScrollBehavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'auto'
        : 'smooth';
      const el = rowElement(id);
      if (el === undefined) {
        // Not mounted: the virtualizer knows where it is.
        const at = items.findIndex((item) => item.kind === 'row' && rowId(item.row) === id);
        if (virtualized && at >= 0) virtualizer.scrollToIndex(at, { align: 'center', behavior });
      } else {
        // In full view already: below the pinned header, inside the box and the window.
        const r = el.getBoundingClientRect();
        const edge = box.getBoundingClientRect();
        const head = box.querySelector('thead')?.getBoundingClientRect().height ?? 0;
        const seen =
          r.top >= Math.max(edge.top + head, 0) &&
          r.bottom <= Math.min(edge.bottom, window.innerHeight);
        if (!seen) el.scrollIntoView({ block: 'center', behavior });
      }
      if (!focus) return;
      setFocusId(id);
      // A virtualized row mounts once the scroll nears it; focus it then, where it is.
      let frames = 0;
      const land = (): void => {
        const row = rowElement(id);
        if (row !== undefined) row.focus({ preventScroll: true });
        else if (frames++ < 120) requestAnimationFrame(land);
      };
      land();
    },
  }));
  const onRowKey = (row: T, id: string, event: KeyboardEvent<HTMLTableRowElement>): void => {
    // The row's own keys, not those of a control inside it, nor the second
    // key of a sequence the app is waiting on (G then M).
    if (event.target !== event.currentTarget || sequenceArmed()) return;
    const index = ids.indexOf(id);
    const plain = !event.metaKey && !event.ctrlKey && !event.altKey;
    const arrow = (key: string): boolean => plain && event.key === key;
    const is = (shortcut: string): boolean => pressed(event, shortcut, keys);
    const go = (to: number): void => {
      const next = ids[Math.max(0, Math.min(ids.length - 1, to))];
      if (next !== undefined) focusRow(next);
    };
    const extend = (step: 1 | -1): void => {
      const start = anchor.current ?? { id, base: [...picked] };
      anchor.current = start;
      const to = Math.max(0, Math.min(ids.length - 1, index + step));
      const from = ids.indexOf(start.id);
      const run = ids.slice(Math.min(from, to), Math.max(from, to) + 1);
      setPicked([...new Set([...start.base, ...run])]);
      go(to);
    };
    let handled = true;
    if ((arrow('ArrowDown') && !event.shiftKey) || is('list.next')) {
      anchor.current = null;
      go(index + 1);
    } else if ((arrow('ArrowUp') && !event.shiftKey) || is('list.previous')) {
      anchor.current = null;
      go(index - 1);
    } else if (arrow('Home')) go(0);
    else if (arrow('End')) go(ids.length - 1);
    else if (selectable && ((arrow('ArrowDown') && event.shiftKey) || is('list.extend-next'))) {
      extend(1);
    } else if (selectable && ((arrow('ArrowUp') && event.shiftKey) || is('list.extend-previous'))) {
      extend(-1);
    } else if (selectable && is('list.select')) {
      anchor.current = null;
      setPicked(picked.has(id) ? [...picked].filter((entry) => entry !== id) : [...picked, id]);
    } else if (
      onRowOpen !== undefined &&
      ((arrow('Enter') && !event.shiftKey) || is('list.open'))
    ) {
      onRowOpen(row);
    } else if (onRowPreview !== undefined && is('list.preview')) {
      onRowPreview(row);
    } else if (arrow('Escape')) {
      // First the selection; with none, out of the list.
      if (picked.size > 0) setPicked([]);
      else {
        event.currentTarget.blur();
        handled = false;
      }
    } else {
      const action =
        rowActions === undefined ? undefined : actionPressed(event, rowActions(row), keys);
      if (action === undefined) handled = false;
      else action.onSelect();
    }
    if (handled) {
      event.preventDefault();
      event.stopPropagation();
    }
  };
  const menuOnCard = rowActions !== undefined && rowMenuOnCard;
  const hasTrailing = menuOnCard || columns.some((column) => column.cardTrailing);

  // Near the end of what is loaded: on scroll, and whenever the rows change,
  // since a first page shorter than the container never scrolls at all.
  const endReached = useRef(onEndReached);
  endReached.current = onEndReached;
  const wantsEnd = onEndReached !== undefined && !loadingMore;
  useEffect(() => {
    const el = scrollRef.current;
    if (el === null || !wantsEnd) return;
    const check = (): void => {
      if (el.scrollHeight - el.scrollTop - el.clientHeight < END_MARGIN) endReached.current?.();
    };
    check();
    el.addEventListener('scroll', check, { passive: true });
    return () => {
      el.removeEventListener('scroll', check);
    };
  }, [wantsEnd, ordered.length]);

  /*
   * A table of few columns leaves room at its end. That room goes to the
   * columns whose content is cut off, header or cell, up to what each needs;
   * a table with nothing cut off keeps its declared widths. A column somebody
   * resized keeps their width. Only what is rendered is measured, which on a
   * virtualized table is the rows in view, and only once, before the first
   * paint with rows: from then on the widths are locked.
   */
  const hasRows = ordered.length > 0;
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const table = el?.querySelector('table');
    if (!fixed || !hasRows || fit.key === fitKey || el == null || table == null) return;
    const spare = el.clientWidth - table.offsetWidth;
    const done = (extra: Readonly<Record<string, number>>): void => {
      setFit({ key: fitKey, extra });
    };
    if (spare <= 0) {
      done({});
      return;
    }
    const heads = [...table.querySelectorAll<HTMLTableCellElement>('thead th[data-column-id]')];
    const span = heads[0]?.parentElement?.children.length ?? 0;
    const overflow: Record<string, number> = {};
    for (const th of heads) {
      const id = th.dataset['columnId'];
      if (id === undefined || widths[id] !== undefined) continue;
      const cells = [
        th,
        ...[...table.tBodies].flatMap((b) =>
          [...b.rows].flatMap((row) =>
            row.cells.length === span && row.cells[th.cellIndex] !== undefined
              ? [row.cells[th.cellIndex] as HTMLTableCellElement]
              : [],
          ),
        ),
      ];
      let need = 0;
      for (const cell of cells) {
        for (const node of [cell, ...cell.querySelectorAll<HTMLElement>('*')]) {
          if (node.clientWidth > 0) need = Math.max(need, node.scrollWidth - node.clientWidth);
        }
      }
      if (need > 0) overflow[id] = need;
    }
    done(stretchOverflowing(spare, overflow));
  }, [fitKey, fixed, hasRows, fit.key, widths]);

  const body = (
    <Table
      stickyHeader={stickyHeader}
      dense={dense}
      aria-label={label}
      containerRef={scrollRef}
      {...(moves ? { role: 'grid' } : {})}
      {...(moves && selectable ? { 'aria-multiselectable': true } : {})}
      // Only when virtualized. On a fully rendered table the DOM already tells
      // the truth, and a redundant count is one more thing to get wrong.
      {...(virtualized ? { 'aria-rowcount': items.length + 1 } : {})}
      className={cn(CARD.table, fixed && 'table-fixed touch:w-full! touch:table-auto', className)}
      // Fixed widths add up to the table's: `w-max` would size it on its
      // content, and the browser would then share that out as cells came and
      // went. The leading controls are 40px each, the actions 48px.
      {...(fixed
        ? {
            style: {
              width:
                columns.reduce((sum, column) => sum + widthFor(column), 0) +
                leadingColumns * 40 +
                (rowActions ? 48 : 0),
            },
          }
        : {})}
      // While more is on its way, the wheel stays with the table at the end
      // of what has loaded: WebKit handed it to the page, which slid away
      // under the reader until the next page arrived.
      containerClassName={cn(
        onEndReached !== undefined && 'overscroll-y-contain',
        containerClassName,
      )}
      {...(virtualized
        ? {
            contentHeight:
              headHeight + virtualizer.getTotalSize() + (loadingMore ? estimateRowHeight : 0),
          }
        : {})}
    >
      {caption === undefined ? null : (
        <caption className="mt-3 text-xs text-fg-muted">{caption}</caption>
      )}
      <TableHeader className={CARD.head}>
        <TableRow className={CARD.headRow}>
          {canReorder ? (
            <TableHead className="w-10 touch:hidden">
              <span className="sr-only">Reorder</span>
            </TableHead>
          ) : null}

          {selectable ? (
            <TableHead className="w-10 touch:me-auto touch:flex touch:h-auto! touch:items-center touch:gap-3 touch:p-0!">
              <Checkbox
                checked={allPicked ? true : somePicked ? 'indeterminate' : false}
                // Named for what it does now, not for what it is. "Select all"
                // on a table where everything is already selected is a lie.
                aria-label={allPicked ? `Clear selection` : `Select all ${String(ids.length)} rows`}
                onCheckedChange={() => {
                  setPicked(allPicked ? [] : ids);
                }}
              />
              {/* The cards have no header row to sit the box above, so it says
                  what it is. Hidden from assistive tech: the box is named. */}
              <span aria-hidden className="hidden text-sm font-semibold text-fg-muted touch:inline">
                Select all
              </span>
            </TableHead>
          ) : null}

          {renderDetail ? (
            <TableHead className="w-10 touch:hidden">
              <span className="sr-only">Expand</span>
            </TableHead>
          ) : null}

          {columns.map((column) => {
            const position = activeSorts.findIndex((entry) => entry.columnId === column.id);
            const current = activeSorts[position];
            const isSorted = current !== undefined;
            const width = fixed ? `${String(widthFor(column))}px` : column.width;
            return (
              <TableHead
                key={column.id}
                data-column-id={column.id}
                numeric={column.numeric ?? false}
                sticky={column.sticky ?? false}
                sortable={column.sortBy !== undefined}
                sortDirection={current?.direction ?? null}
                {...(activeSorts.length > 1 && isSorted ? { sortPriority: position + 1 } : {})}
                onSort={(direction, event) => {
                  // TanStack's own toggle, so a shift-click adds to the sort
                  // or flips a column already in it, and a plain click replaces it.
                  table
                    .getColumn(column.id)
                    ?.toggleSorting(direction === 'descending', multiSort && event.shiftKey);
                }}
                className={cn(
                  // Sortable headers become chips; the rest have nothing to do
                  // on a card and stay only for the cell association.
                  column.sortBy === undefined
                    ? 'touch:sr-only'
                    : cn(
                        'touch:h-auto! touch:w-auto! touch:p-0! touch:[&>button]:mx-0 touch:[&>button]:rounded-full touch:[&>button]:px-3.5',
                        isSorted
                          ? 'touch:[&>button]:bg-accent-subtle touch:[&>button]:text-accent-fg'
                          : 'touch:[&>button]:bg-surface-sunken',
                      ),
                  column.className,
                )}
                {...(width === undefined ? {} : { style: { width } })}
                {...(resizable
                  ? {
                      resizer: (
                        <ResizeHandle
                          name={columnName(column)}
                          width={widthFor(column)}
                          onWidth={(w) => {
                            setWidth(column.id, w);
                          }}
                        />
                      ),
                    }
                  : {})}
              >
                {column.header}
              </TableHead>
            );
          })}

          {rowActions ? (
            <TableHead className="w-12 touch:hidden">
              <span className="sr-only">Actions</span>
            </TableHead>
          ) : null}
        </TableRow>
        {activeSorts.length > 0 ? (
          // The phone's readout of the sort: the header row is gone, so this
          // strip is what says the cards are in an order and which.
          <tr className="hidden touch:flex">
            <td
              colSpan={totalColumns}
              className="touch:flex touch:w-full touch:items-center touch:gap-1.5 touch:px-4 touch:py-3 touch:text-sm touch:font-semibold touch:text-fg-muted"
            >
              <ArrowUpDown aria-hidden className="size-4" />
              Sorted by {describeSorts(activeSorts, columns)}
            </td>
          </tr>
        ) : null}
      </TableHeader>

      <TableBody className={CARD.section}>
        {ordered.length === 0 ? (
          <TableRow className="touch:block">
            <TableCell
              colSpan={totalColumns}
              className={cn('py-8 text-center text-fg-muted', CARD.cell, 'touch:px-4! touch:py-8!')}
            >
              {empty}
            </TableCell>
          </TableRow>
        ) : null}

        {paddingTop > 0 ? (
          // A spacer row rather than a transform: a `<tbody>` may only contain
          // rows, and transforming them breaks the column widths the header is
          // measured against.
          <SpacerRow
            height={paddingTop}
            rowHeight={estimateRowHeight}
            leading={leadingColumns}
            columns={columns.length}
            trailing={rowActions ? 1 : 0}
          />
        ) : null}

        {visible.map(({ item, index: rowIndex }) => {
          if (item.kind === 'group') {
            const group = item.row;
            const value = String(group.groupingValue);
            const isShut = shut.has(value);
            const leaves = group.getLeafRows().map((leaf) => leaf.original);
            return (
              <TableRow
                key={group.id}
                {...(virtualized ? { 'aria-rowindex': rowIndex + 2 } : {})}
                className="bg-surface-sunken touch:flex touch:items-center touch:px-4 touch:py-1"
              >
                <TableHead
                  scope="rowgroup"
                  colSpan={leadingColumns + 1}
                  className={cn('h-9.5 py-0 text-sm font-semibold text-fg', CARD.cell)}
                >
                  <button
                    type="button"
                    aria-expanded={!isShut}
                    aria-label={`${value}, ${String(leaves.length)} ${leaves.length === 1 ? 'row' : 'rows'}`}
                    onClick={() => {
                      setCollapsed(
                        isShut
                          ? collapsed.filter((entry) => entry !== value)
                          : [...collapsed, value],
                      );
                    }}
                    className={cn(
                      'relative -mx-1 inline-flex items-center gap-2 rounded-xs px-1 tap-target touch:min-h-tap',
                      'focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-border-focus',
                    )}
                  >
                    <ChevronRight
                      aria-hidden
                      className={cn(
                        'size-4 text-fg-muted transition-transform duration-(--animate-duration-fast)',
                        !isShut && 'rotate-90',
                      )}
                    />
                    {value}
                    <span className="font-medium text-fg-muted tabular-nums">{leaves.length}</span>
                  </button>
                </TableHead>
                {columns.slice(1).map((column) => (
                  <TableCell
                    key={column.id}
                    numeric={column.numeric ?? false}
                    className="h-9.5 py-0 text-sm font-medium text-fg-muted touch:hidden"
                  >
                    {column.aggregate?.(leaves) ?? null}
                  </TableCell>
                ))}
              </TableRow>
            );
          }
          const row = item.row;
          const id = rowId(row);
          const stripe = striped && (place.get(id) ?? 0) % 2 === 1 && !picked.has(id);
          const detail = renderDetail?.(row) ?? null;
          const isOpen = open.has(id) && detail !== null;
          const name = describeRow?.(row) ?? id;

          return (
            <Fragment key={id}>
              <DataRow
                id={id}
                name={name}
                className={cn(
                  CARD.row,
                  CARD.rowStart[(selectable ? 1 : 0) + (canReorder ? 1 : 0)],
                  renderDetail ? 'touch:pe-14' : onRowClick && 'touch:pe-10',
                  // By position, not `even:`: a detail row, a group header or
                  // a virtualizer's spacer would each shift an nth-child count.
                  stripe && STRIPE,
                  // The hover a step past the stripe, so it shows on both.
                  striped && 'hover:bg-surface-hover',
                  hasTrailing && CARD.titleBreak,
                )}
                leadClassName={cn(CARD.leadCell, CARD.lead[0])}
                {...(stripe ? { 'data-striped': true } : {})}
                {...(virtualized
                  ? {
                      measure: virtualizer.measureElement,
                      'data-index': rowIndex,
                      // At a desk, exactly the estimate, so measuring a row
                      // never moves the total height or the rows under the
                      // reader. A card is as tall as it is.
                      height: estimateRowHeight,
                    }
                  : {})}
                // 1-based, and past the header row, which is row 1.
                {...(virtualized ? { 'aria-rowindex': rowIndex + 2 } : {})}
                reorderable={canReorder}
                selected={picked.has(id)}
                data-row-id={id}
                {...(moves
                  ? {
                      tabIndex: id === tabbableId ? 0 : -1,
                      'data-roving-row': true,
                      // A grid's row says whether it is selected either way.
                      ...(selectable ? { 'aria-selected': picked.has(id) } : {}),
                      onKeyDown: (event: KeyboardEvent<HTMLTableRowElement>) => {
                        onRowKey(row, id, event);
                      },
                      onFocus: (event: FocusEvent<HTMLTableRowElement>) => {
                        if (event.target === event.currentTarget) setFocusId(id);
                      },
                    }
                  : {})}
                {...(activeRowId === id
                  ? {
                      'aria-current': true as const,
                      'data-active': true,
                    }
                  : {})}
                {...(onRowClick
                  ? {
                      onClick: () => {
                        onRowClick(row);
                      },
                    }
                  : {})}
              >
                {selectable ? (
                  <TableCell
                    // Lower than the grip: a checkbox is smaller than its tap
                    // area, and it lines up with the title's first line.
                    className={cn(
                      'w-10',
                      CARD.leadCell,
                      CARD.lead[canReorder ? 1 : 0],
                      'touch:top-4',
                    )}
                  >
                    <Checkbox
                      checked={picked.has(id)}
                      aria-label={`Select ${name}`}
                      onClick={(event) => {
                        // The row may do something of its own; picking is not it.
                        event.stopPropagation();
                      }}
                      onCheckedChange={(next) => {
                        setPicked(
                          next === true
                            ? [...picked, id]
                            : [...picked].filter((entry) => entry !== id),
                        );
                      }}
                    />
                  </TableCell>
                ) : null}

                {renderDetail ? (
                  // The disclosure goes to the card's far edge, where a phone
                  // list puts its chevron.
                  <TableCell className={cn('w-10', CARD.leadCell, 'touch:end-2')}>
                    {detail === null ? (
                      // A chevron that opens onto nothing teaches people to
                      // stop pressing them.
                      <span className="sr-only">No further detail</span>
                    ) : (
                      <button
                        type="button"
                        aria-expanded={isOpen}
                        aria-controls={`${base}-${id}`}
                        aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${name}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          if (open.has(id)) setOpen([...open].filter((entry) => entry !== id));
                          else setOpen(singleExpand ? [id] : [...open, id]);
                        }}
                        className={cn(
                          'flex size-tap items-center justify-center rounded-sm text-fg-subtle',
                          'transition-colors duration-(--animate-duration-fast)',
                          'hover:bg-surface-hover hover:text-fg',
                          'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-border-focus',
                        )}
                      >
                        <ChevronRight
                          aria-hidden
                          className={cn(
                            'size-4 transition-transform duration-(--animate-duration-fast)',
                            isOpen && 'rotate-90',
                          )}
                        />
                      </button>
                    )}
                  </TableCell>
                ) : null}

                {columns.map((column, index) => (
                  <TableCell
                    key={column.id}
                    numeric={column.numeric ?? false}
                    sticky={column.sticky ?? false}
                    {...(index > 0 && column.shortHeader !== undefined && !column.cardTrailing
                      ? { 'data-label': column.shortHeader }
                      : {})}
                    className={cn(
                      CARD.cell,
                      index === 0 ? CARD.title : column.cardTrailing ? CARD.trailing : CARD.meta,
                      index === 0 && hasTrailing && CARD.titleBeside,
                      index > 0 &&
                        column.shortHeader !== undefined &&
                        !column.cardTrailing &&
                        CARD.label,
                      column.hideOnCard && 'touch:hidden',
                      // One line, ellipsized: a value that wrapped made its row
                      // taller than the rest, and the table's height jumped
                      // as the row was measured.
                      fixed &&
                        'overflow-hidden text-ellipsis whitespace-nowrap touch:overflow-visible touch:whitespace-normal',
                      column.className,
                    )}
                  >
                    {column.cell(row)}
                  </TableCell>
                ))}

                {rowActions ? (
                  <TableCell
                    className={cn('w-12', menuOnCard ? [CARD.cell, CARD.trailing] : 'touch:hidden')}
                  >
                    <RowMenu name={name} actions={rowActions(row)} />
                  </TableCell>
                ) : null}

                {onRowClick && !renderDetail ? (
                  // A card that opens something says so with a chevron. It
                  // exists only on the card: a desk row has its hover instead.
                  <td
                    aria-hidden
                    className="hidden text-fg-subtle touch:absolute touch:end-3 touch:top-1/2 touch:block touch:-translate-y-1/2"
                  >
                    <ChevronRight className="size-4.5" />
                  </td>
                ) : null}
              </DataRow>

              {isOpen ? (
                <TableRow
                  id={`${base}-${id}`}
                  className="bg-surface-sunken/50 touch:block touch:bg-surface touch:px-4 touch:pb-3.5"
                >
                  {leadingColumns > 0 ? (
                    <TableCell colSpan={leadingColumns} className="touch:hidden" />
                  ) : null}
                  <TableCell
                    colSpan={columns.length}
                    className={cn(
                      'h-auto py-3',
                      CARD.cell,
                      'touch:rounded-md touch:bg-surface-sunken touch:p-3.5!',
                    )}
                  >
                    <div className="motion-safe:animate-fade-in">{detail}</div>
                  </TableCell>
                </TableRow>
              ) : null}
            </Fragment>
          );
        })}

        {paddingBottom > 0 ? (
          <SpacerRow
            height={paddingBottom}
            rowHeight={estimateRowHeight}
            leading={leadingColumns}
            columns={columns.length}
            trailing={rowActions ? 1 : 0}
          />
        ) : null}

        {loadingMore ? (
          // A row in the table's own shape, a bar in each cell, as tall as a
          // row: when the page arrives it takes the row's place and nothing
          // under the reader's eye moves. A card's shape under a finger.
          <TableRow aria-busy="true" className="touch:block" style={{ height: estimateRowHeight }}>
            {Array.from({ length: totalColumns }, (_, i) => (
              <TableCell key={i} className={i === 0 ? 'touch:block touch:h-13' : 'touch:hidden'}>
                {i === 0 ? <span className="sr-only">Loading more</span> : null}
                <Skeleton
                  className={cn('h-3.5', i === 0 ? 'w-40 max-w-full touch:w-full' : 'w-3/4')}
                />
              </TableCell>
            ))}
          </TableRow>
        ) : null}
      </TableBody>
    </Table>
  );

  const bulkBar =
    selectable && picked.size > 0 ? (
      /*
       * Under the table and sticky to the bottom of the viewport, not floating
       * over the table. In flow it never covers the last row: under a short
       * table it simply sits beneath it, and on a long one it rides the bottom
       * edge until the table's end scrolls up to meet it. Inverted, so it reads
       * as a mode the page is in rather than one more row. It wraps on a narrow
       * screen instead of pushing the count off it.
       */
      <div
        role="group"
        aria-label={`${String(picked.size)} selected`}
        {...PINNED_BAR}
        className={cn('sticky bottom-4 z-20', bulkBarClass, 'motion-safe:animate-pop-in')}
      >
        <span aria-live="polite" className="text-sm font-semibold tabular-nums">
          {picked.size} selected
        </span>
        <span aria-hidden className="mx-2 h-5 w-px bg-fg-on-invert/25" />
        <div className="flex flex-wrap items-center gap-1.5">{bulkActions?.(pickedRowObjects)}</div>
        <Button
          size="sm"
          variant="ghost"
          aria-label="Clear selection"
          startIcon={<X />}
          onClick={() => {
            setPicked([]);
          }}
        />
      </div>
    ) : null;

  return (
    <div className="min-w-0 space-y-3">
      {reorderable && activeSorts.length > 0 ? (
        <p role="status" className="text-xs text-fg-muted">
          Rows are sorted by a column, so they cannot be reordered by hand. Clear the sort to drag
          them.
        </p>
      ) : null}

      {canReorder ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          accessibility={{ announcements }}
          modifiers={[restrictToVerticalAxis, restrictToParentElement]}
          onDragEnd={({ active, over }: DragEndEvent) => {
            if (!over || active.id === over.id) return;
            const from = ids.indexOf(String(active.id));
            const to = ids.indexOf(String(over.id));
            onReorder?.({ id: String(active.id), from, to, order: arrayMove([...ids], from, to) });
          }}
        >
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            {body}
          </SortableContext>
        </DndContext>
      ) : (
        body
      )}

      {bulkBar}
    </div>
  );
}

/**
 * One row, sortable when it needs to be.
 *
 * The handle lives in its own cell rather than on the row: a row is where the
 * click-to-select and the row link live, and a whole-row activator eats both.
 */
function DataRow({
  id,
  name,
  reorderable,
  selected,
  onClick,
  className,
  leadClassName,
  measure,
  height,
  children,
  ...rest
}: {
  id: string;
  name: string;
  reorderable: boolean;
  selected: boolean;
  onClick?: () => void;
  className?: string;
  /** Classes for the grip cell, a leading control like the checkbox. */
  leadClassName?: string;
  /**
   * The virtualizer's measuring ref. Rows are measured rather than trusted to
   * the estimate, because a card under a finger is twice a desk row's height.
   */
  measure?: (node: HTMLTableRowElement | null) => void;
  /** A desk row's height in px; a card under a finger keeps its own. */
  height?: number;
  children: ReactNode;
  /** `aria-rowindex` when the body is virtualized. */
  'aria-rowindex'?: number;
  'data-index'?: number;
  'data-striped'?: boolean;
  'aria-current'?: true;
  'data-active'?: boolean;
  'aria-selected'?: boolean;
  tabIndex?: number;
  'data-row-id'?: string;
  'data-roving-row'?: boolean;
  onKeyDown?: (event: KeyboardEvent<HTMLTableRowElement>) => void;
  onFocus?: (event: FocusEvent<HTMLTableRowElement>) => void;
}): JSX.Element {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled: !reorderable });

  return (
    <TableRow
      ref={reorderable ? setNodeRef : measure}
      selected={selected}
      interactive={onClick !== undefined}
      style={
        reorderable
          ? { transform: CSS.Transform.toString(transform), transition, position: 'relative' }
          : height === undefined
            ? undefined
            : { height }
      }
      className={cn(
        className,
        height !== undefined && 'touch:h-auto!',
        // Held: raised, shadowed and tipped a hair, the same pick-up cue as a
        // Kanban card, so a dragged row reads as lifted rather than selected.
        isDragging && 'z-10 rounded-md bg-surface-raised shadow-lg [rotate:-0.5deg]',
        // The open record: an accent edge down the leading side, on the fill.
        'data-active:bg-accent-subtle data-active:shadow-[inset_3px_0_0_var(--reach-color-accent)]',
        // The row the keyboard is on: a wash and a ring, visible without a pointer.
        'focus-visible:bg-surface-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-border-focus',
      )}
      {...(onClick ? { onClick } : {})}
      {...rest}
    >
      {reorderable ? (
        <TableCell className={cn('w-10', leadClassName)}>
          <button
            type="button"
            ref={setActivatorNodeRef}
            aria-label={`Reorder ${name}`}
            className={cn(
              'flex size-tap cursor-grab touch-none items-center justify-center rounded-sm text-fg-subtle',
              'hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-border-focus',
            )}
            onClick={(event) => {
              event.stopPropagation();
            }}
            {...attributes}
            {...listeners}
          >
            <GripVertical aria-hidden className="size-4" />
          </button>
        </TableCell>
      ) : null}
      {children}
    </TableRow>
  );
}

/**
 * The rows a virtualized body has not drawn, as their skeleton.
 *
 * A fling can outrun the render: the browser scrolls on its own and, until the
 * rows for the new position are drawn, shows what is there. Here that is a bar
 * in each column, one per row height, in the shape of the rows rather than a
 * blank box. Cell backgrounds, so it costs no nodes and nothing to paint while
 * it scrolls.
 */
function SpacerRow({
  height,
  rowHeight,
  leading,
  columns,
  trailing,
}: {
  height: number;
  rowHeight: number;
  leading: number;
  columns: number;
  trailing: number;
}): JSX.Element {
  const tile = `${String(rowHeight)}px`;
  const fill = 'var(--reach-color-surface-sunken)';
  // The hairline under each row, as `divide-y` draws it.
  const line =
    'linear-gradient(transparent calc(100% - 1px), var(--reach-color-border) calc(100% - 1px))';
  // A bar as tall as the loading row's, centred in the row.
  const bar = `linear-gradient(transparent calc(50% - 7px), ${fill} calc(50% - 7px), ${fill} calc(50% + 7px), transparent calc(50% + 7px))`;
  const blank: CSSProperties = {
    backgroundImage: line,
    backgroundSize: `100% ${tile}`,
    backgroundRepeat: 'repeat-y',
  };
  const barred: CSSProperties = {
    backgroundImage: `${bar}, ${line}`,
    backgroundSize: `75% ${tile}, 100% ${tile}`,
    backgroundRepeat: 'repeat-y',
    backgroundOrigin: 'content-box, border-box',
  };
  return (
    <tr aria-hidden data-skeleton style={{ height }} className="touch:block">
      {Array.from({ length: leading + columns + trailing }, (_, i) => {
        const data = i >= leading && i < leading + columns;
        return (
          <TableCell
            key={i}
            style={data ? barred : blank}
            className={cn(
              'h-auto py-0 [[data-dense]_&]:h-auto [[data-dense]_&]:py-0',
              i === leading ? 'touch:block touch:h-full' : 'touch:hidden',
            )}
          />
        );
      })}
    </tr>
  );
}

/**
 * The edge of a header that changes its column's width.
 *
 * A `separator` with a value, which is what the APG calls a focusable splitter:
 * Tab reaches it, the arrow keys move it 16px at a time (64px with Shift), and
 * a screen reader hears the width; the pointer drags it. It never sorts the
 * column it sits on. Hidden under a finger, where the table is a list of cards
 * and has no columns to size.
 */
function ResizeHandle({
  name,
  width,
  onWidth,
}: {
  name: string;
  width: number;
  onWidth: (width: number) => void;
}): JSX.Element {
  const drag = useRef<{ x: number; width: number } | null>(null);
  const [resizing, setResizing] = useState(false);
  const stop = (): void => {
    drag.current = null;
    setResizing(false);
  };
  return (
    <span
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${name}`}
      aria-valuenow={width}
      aria-valuemin={COLUMN_MIN}
      aria-valuemax={COLUMN_MAX}
      tabIndex={0}
      onClick={(event) => {
        event.stopPropagation();
      }}
      onPointerDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { x: event.clientX, width };
        setResizing(true);
      }}
      onPointerMove={(event) => {
        if (drag.current === null) return;
        onWidth(drag.current.width + event.clientX - drag.current.x);
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
      onKeyDown={(event: KeyboardEvent<HTMLSpanElement>) => {
        const step = event.shiftKey ? 64 : 16;
        if (event.key === 'ArrowRight') onWidth(width + step);
        else if (event.key === 'ArrowLeft') onWidth(width - step);
        else return;
        event.preventDefault();
      }}
      className={cn(
        // Inside its own header, not straddling the edge: a sticky header's
        // next cell paints over anything that overhangs into it.
        'group/resize absolute inset-y-0 end-0 z-10 flex w-2.5 cursor-col-resize touch-none justify-end select-none touch:hidden',
        'focus-visible:outline-2 focus-visible:outline-border-focus',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'my-2 w-0.5 rounded-full transition-[background-color,width] duration-(--animate-duration-fast)',
          resizing
            ? 'w-[3px] bg-accent'
            : 'bg-border-strong group-hover/resize:bg-accent group-focus-visible/resize:bg-accent',
        )}
      />
    </span>
  );
}
