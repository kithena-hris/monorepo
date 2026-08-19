'use client';

import {
  Fragment,
  useCallback,
  useId,
  useMemo,
  useRef,
  useState,
  type JSX,
  type ReactNode,
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
  createCoreRowModel,
  createExpandedRowModel,
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
  type RowData,
  type SortingState,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronRight, GripVertical, X } from 'lucide-react';

import { cn } from '../../lib/cn';
import { Button } from '../button/button';
import { Checkbox } from '../checkbox/checkbox';
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
 * ### On a phone it is still a table
 *
 * It scrolls sideways with the identity column pinned. Turning rows into cards
 * loses the header association, the column order and any chance of comparing
 * two rows, which is most of what a table is for. Where a card list is
 * genuinely better, render a list.
 */

/**
 * The feature set this table opts into, declared once.
 *
 * TanStack Table v9 is modular: a feature that is not named here is not in the
 * bundle and its options do not typecheck. Sorting, selection and expansion are
 * the three this component exposes, so they are the three listed. Filtering,
 * pagination, grouping and pinning are deliberately absent, and adding one is a
 * decision made here rather than a prop appearing by accident.
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
  coreRowModel: createCoreRowModel(),
});

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
  /** Makes the column sortable. Return the value to compare on. */
  sortBy?: (row: T) => string | number;
  /** A short label for the column, used in the stacked readout on narrow screens. */
  shortHeader?: string;
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

export interface DataTableProps<T extends TableRow> {
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

  /** Current sort. Uncontrolled, and sorted for you, when omitted. */
  sort?: DataTableSort | null;
  onSortChange?: (sort: DataTableSort | null) => void;
  defaultSort?: DataTableSort | null;

  /** Drag handles on every row. Disabled while a sort is active. */
  reorderable?: boolean;
  onReorder?: (move: DataTableReorder) => void;

  /** A word for what a row is, used in every generated control name. */
  describeRow?: (row: T) => string;
  onRowClick?: (row: T) => void;
  /** Shown in place of the body when there are no rows. */
  empty?: ReactNode;
  stickyHeader?: boolean;
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
  /** Estimated row height in px, used before a row has been measured. */
  estimateRowHeight?: number;
}

export function DataTable<T extends TableRow>({
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
  defaultSort = null,
  reorderable = false,
  onReorder,
  describeRow,
  onRowClick,
  empty = 'Nothing to show.',
  stickyHeader = false,
  containerClassName,
  className,
  virtualize = 'auto',
  virtualizeThreshold = 100,
  estimateRowHeight = 44,
}: DataTableProps<T>): JSX.Element {
  const base = useId();
  const [openRows, setOpenRows] = useState<readonly string[]>(defaultExpanded ?? []);
  const [pickedRows, setPickedRows] = useState<readonly string[]>(defaultSelected ?? []);
  const [ownSort, setOwnSort] = useState<DataTableSort | null>(defaultSort);

  const open = new Set(expanded ?? openRows);
  const picked = new Set(selected ?? pickedRows);
  const activeSort = sort === undefined ? ownSort : sort;

  const setOpen = (next: readonly string[]): void => {
    if (expanded === undefined) setOpenRows(next);
    onExpandedChange?.(next);
  };
  const setPicked = (next: readonly string[]): void => {
    if (selected === undefined) setPickedRows(next);
    onSelectedChange?.(next);
  };
  const setSort = (next: DataTableSort | null): void => {
    if (sort === undefined) setOwnSort(next);
    onSortChange?.(next);
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
      columns.map((column) => ({
        id: column.id,
        // A column with no `sortBy` is not sortable, and an accessor returning
        // the row itself would sort by object identity.
        accessorFn: column.sortBy ? (row: T) => column.sortBy?.(row) ?? null : () => null,
        enableSorting: column.sortBy !== undefined,
        sortFn: 'alphanumeric',
      })),
    [columns],
  );

  const sorting: SortingState = useMemo(
    () =>
      activeSort ? [{ id: activeSort.columnId, desc: activeSort.direction === 'descending' }] : [],
    [activeSort],
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
    state: { sorting, rowSelection, expanded: expandedState },
    onSortingChange: (updater) => {
      const next = typeof updater === 'function' ? updater(sorting) : updater;
      const first = next[0];
      setSort(
        first ? { columnId: first.id, direction: first.desc ? 'descending' : 'ascending' } : null,
      );
    },
    onRowSelectionChange: (updater) => {
      const next = typeof updater === 'function' ? updater(rowSelection) : updater;
      setPicked(Object.keys(next).filter((id) => next[id]));
    },
  });

  const ordered = table.getRowModel().rows.map((row) => row.original);
  const ids = ordered.map((row) => rowId(row));
  const allPicked = ids.length > 0 && ids.every((id) => picked.has(id));
  const somePicked = ids.some((id) => picked.has(id));
  const pickedRowObjects = ordered.filter((row) => picked.has(rowId(row)));

  // A dragged row means nothing in a sorted table: the next sort discards it.
  const canReorder = reorderable && activeSort === null;

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
  const wantsVirtual = virtualize === 'auto' ? ordered.length >= virtualizeThreshold : virtualize;
  const virtualized = wantsVirtual && !canReorder && renderDetail === undefined;

  // Memoised for the reason spelled out in `virtual-list.tsx`: a fresh arrow
  // each render reads as a changed configuration, and the recomputation that
  // follows is paid on every scroll frame.
  const getScrollElement = useCallback(() => scrollRef.current, []);
  const estimateSize = useCallback(() => estimateRowHeight, [estimateRowHeight]);

  const virtualizer = useVirtualizer({
    count: virtualized ? ordered.length : 0,
    getScrollElement,
    estimateSize,
    // Enough rows above and below that a fast flick does not show a gap, and
    // few enough that the saving is real.
    overscan: 8,
  });

  const virtualRows = virtualized ? virtualizer.getVirtualItems() : [];
  const paddingTop = virtualRows.length > 0 ? (virtualRows[0]?.start ?? 0) : 0;
  const paddingBottom =
    virtualRows.length > 0
      ? virtualizer.getTotalSize() - (virtualRows[virtualRows.length - 1]?.end ?? 0)
      : 0;

  /** The rows to render, paired with the 1-based index a reader should hear. */
  const visible: { row: T; index: number }[] = virtualized
    ? /*
       * `flatMap` with a presence check, not an index lookup asserted to be
       * populated. The virtualizer reports indices from the measurement it last
       * took, so for one render after the row count shrinks, a filter clearing,
       * a page shrinking, it can name an index that no longer exists. The old
       * assertion turned that into an `undefined` row handed to a cell renderer;
       * this drops it instead.
       */
      virtualRows.flatMap((item) => {
        const row = ordered[item.index];
        return row === undefined ? [] : [{ row, index: item.index }];
      })
    : ordered.map((row, index) => ({ row, index }));

  const leadingColumns = (renderDetail ? 1 : 0) + (selectable ? 1 : 0) + (canReorder ? 1 : 0);
  const totalColumns = columns.length + leadingColumns;

  const body = (
    <Table
      stickyHeader={stickyHeader}
      aria-label={label}
      containerRef={scrollRef}
      // Only when virtualized. On a fully rendered table the DOM already tells
      // the truth, and a redundant count is one more thing to get wrong.
      {...(virtualized ? { 'aria-rowcount': ordered.length + 1 } : {})}
      className={className}
      {...(containerClassName === undefined ? {} : { containerClassName })}
    >
      {caption === undefined ? null : (
        <caption className="mt-3 text-xs text-fg-muted">{caption}</caption>
      )}
      <TableHeader>
        <TableRow>
          {canReorder ? (
            <TableHead className="w-10">
              <span className="sr-only">Reorder</span>
            </TableHead>
          ) : null}

          {selectable ? (
            <TableHead className="w-10">
              <Checkbox
                checked={allPicked ? true : somePicked ? 'indeterminate' : false}
                // Named for what it does now, not for what it is. "Select all"
                // on a table where everything is already selected is a lie.
                aria-label={allPicked ? `Clear selection` : `Select all ${String(ids.length)} rows`}
                onCheckedChange={() => {
                  setPicked(allPicked ? [] : ids);
                }}
              />
            </TableHead>
          ) : null}

          {renderDetail ? (
            <TableHead className="w-10">
              <span className="sr-only">Expand</span>
            </TableHead>
          ) : null}

          {columns.map((column) => {
            const isSorted = activeSort?.columnId === column.id;
            return (
              <TableHead
                key={column.id}
                numeric={column.numeric ?? false}
                sticky={column.sticky ?? false}
                sortable={column.sortBy !== undefined}
                sortDirection={isSorted ? activeSort.direction : null}
                onSort={(direction) => {
                  setSort({ columnId: column.id, direction });
                }}
                className={column.className}
                {...(column.width === undefined ? {} : { style: { width: column.width } })}
              >
                {column.header}
              </TableHead>
            );
          })}
        </TableRow>
      </TableHeader>

      <TableBody>
        {ordered.length === 0 ? (
          <TableRow>
            <TableCell colSpan={totalColumns} className="py-8 text-center text-fg-muted">
              {empty}
            </TableCell>
          </TableRow>
        ) : null}

        {paddingTop > 0 ? (
          // A spacer row rather than a transform: a `<tbody>` may only contain
          // rows, and transforming them breaks the column widths the header is
          // measured against.
          <tr aria-hidden style={{ height: paddingTop }} />
        ) : null}

        {visible.map(({ row, index: rowIndex }) => {
          const id = rowId(row);
          const detail = renderDetail?.(row) ?? null;
          const isOpen = open.has(id) && detail !== null;
          const name = describeRow?.(row) ?? id;

          return (
            <Fragment key={id}>
              <DataRow
                id={id}
                name={name}
                // 1-based, and past the header row, which is row 1.
                {...(virtualized ? { 'aria-rowindex': rowIndex + 2 } : {})}
                reorderable={canReorder}
                selected={picked.has(id)}
                {...(onRowClick
                  ? {
                      onClick: () => {
                        onRowClick(row);
                      },
                    }
                  : {})}
              >
                {selectable ? (
                  <TableCell className="w-10">
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
                  <TableCell className="w-10">
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

                {columns.map((column) => (
                  <TableCell
                    key={column.id}
                    numeric={column.numeric ?? false}
                    sticky={column.sticky ?? false}
                    className={column.className}
                  >
                    {column.cell(row)}
                  </TableCell>
                ))}
              </DataRow>

              {isOpen ? (
                <TableRow id={`${base}-${id}`} className="bg-surface-sunken/50">
                  {leadingColumns > 0 ? <TableCell colSpan={leadingColumns} /> : null}
                  <TableCell colSpan={columns.length} className="py-3">
                    <div className="motion-safe:animate-fade-in">{detail}</div>
                  </TableCell>
                </TableRow>
              ) : null}
            </Fragment>
          );
        })}

        {paddingBottom > 0 ? <tr aria-hidden style={{ height: paddingBottom }} /> : null}
      </TableBody>
    </Table>
  );

  return (
    <div className="min-w-0 space-y-2">
      {selectable && picked.size > 0 ? (
        // Above the table, in flow rather than floating: a bar pinned over the
        // last row is a bar that covers the row somebody is about to act on.
        // It wraps on a narrow screen instead of pushing the count off-screen.
        <div
          role="group"
          aria-label={`${String(picked.size)} selected`}
          className={cn(
            'flex flex-wrap items-center gap-2 rounded-md border border-accent bg-accent-subtle px-3 py-2',
            'motion-safe:animate-pop-in',
          )}
        >
          <span aria-live="polite" className="text-sm font-medium text-fg">
            {picked.size} selected
          </span>
          <div className="flex flex-1 flex-wrap items-center gap-2">
            {bulkActions?.(pickedRowObjects)}
          </div>
          <Button
            size="sm"
            variant="ghost"
            startIcon={<X />}
            onClick={() => {
              setPicked([]);
            }}
          >
            Clear
          </Button>
        </div>
      ) : null}

      {reorderable && activeSort !== null ? (
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
  children,
  ...rest
}: {
  id: string;
  name: string;
  reorderable: boolean;
  selected: boolean;
  onClick?: () => void;
  children: ReactNode;
  /** `aria-rowindex` when the body is virtualized. */
  'aria-rowindex'?: number;
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
      ref={reorderable ? setNodeRef : undefined}
      selected={selected}
      interactive={onClick !== undefined}
      style={
        reorderable
          ? { transform: CSS.Transform.toString(transform), transition, position: 'relative' }
          : undefined
      }
      className={cn(isDragging && 'z-10 opacity-60 shadow-md')}
      {...(onClick ? { onClick } : {})}
      {...rest}
    >
      {reorderable ? (
        <TableCell className="w-10">
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
