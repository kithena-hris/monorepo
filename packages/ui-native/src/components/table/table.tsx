import { ArrowUpDown, ChevronDown, ChevronRight, ChevronUp } from 'lucide-react-native';
import { FlashList } from '@shopify/flash-list';
import {
  cloneElement,
  Fragment,
  isValidElement,
  memo,
  useCallback,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Platform } from 'react-native';
import { Pressable, Text as CssText, View } from 'react-native-css/components';
import Sortable from 'react-native-sortables';

import { cn } from '../../lib/cn.ts';
import { dragMotion, move, ReorderHandle, useAnnouncer } from '../../lib/reorder.tsx';
import { Avatar } from '../avatar/avatar.tsx';
import { CheckboxBox, type CheckedState } from '../checkbox/checkbox.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../dropdown-menu/dropdown-menu.tsx';
import { Skeleton } from '../feedback/feedback.tsx';
import { Icon } from '../icon/icon.tsx';
import { Money, type MoneyProps } from '../money/money.tsx';
import { Spinner } from '../spinner/spinner.tsx';

/**
 * A table on a phone, as the design draws it: each row a card. The first
 * column is the card's title, the one figure the rows are compared on sits
 * beside it, and the other values wrap underneath. Every column is still
 * there; nothing scrolls sideways.
 *
 * The web's `DataTable` props, where a phone has the same idea: columns with
 * `numeric`, `hideOnCard`, `cardTrailing`, `shortHeader` and `sortBy`; rows
 * that expand, select, sort, reorder and group; a virtual body for thousands
 * of rows (grouped too, the headings sticky) and a footer that loads more.
 */

export type SortDirection = 'ascending' | 'descending';

export type DataTableSort = { columnId: string; direction: SortDirection };

export type DataTableReorder = { id: string; from: number; to: number; order: readonly string[] };

export type DataColumn<T> = {
  id: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** Right-aligned with tabular figures; the same decimals all the way down. */
  numeric?: boolean;
  /** Left off the card (still in the row's spoken summary when `text` is given). */
  hideOnCard?: boolean;
  /** The figure the rows are compared on, beside the title. One column at most. */
  cardTrailing?: boolean;
  /** The label in front of the value on a card, when `labelled`. */
  shortHeader?: string;
  /** Makes the column sortable, by this value. */
  sortBy?: (row: T) => string | number;
};

export type DataTableProps<T> = {
  rows: readonly T[];
  columns: readonly DataColumn<T>[];
  rowId: (row: T) => string;
  /** The table's accessible name. */
  label: string;
  /** Each value on a card after its column's name: for figures that mean nothing alone. */
  labelled?: boolean;
  /** The whole card opens something: a chevron says so. The web's `onRowClick`. */
  onRowPress?: (row: T) => void;
  /** A word for what a row is, used in every generated control name. */
  describeRow?: (row: T) => string;

  /** A card's details, under it when it is open. Tapping the card opens it. */
  renderDetail?: (row: T) => ReactNode;
  expanded?: readonly string[];
  defaultExpanded?: readonly string[];
  onExpandedChange?: (expanded: readonly string[]) => void;
  /** Only one card open at a time. */
  singleExpand?: boolean;

  /** A leading checkbox on each card, a select-all above, a bulk bar below. */
  selectable?: boolean;
  selected?: readonly string[];
  defaultSelected?: readonly string[];
  onSelectedChange?: (selected: readonly string[]) => void;
  /** The bar's buttons, for the selected rows: `BulkAction`s. */
  bulkActions?: (rows: T[]) => ReactNode;
  /**
   * How many rows a select-all picks: every row that matches, not just the
   * ones loaded. The bar then says "All 20,000 selected".
   */
  total?: number;

  /** A list is a multi-column sort, first sort first. Sorted here when the columns say how (`sortBy`). */
  sort?: DataTableSort | readonly DataTableSort[] | null;
  defaultSort?: DataTableSort | readonly DataTableSort[] | null;
  /** Fires with the primary sort. `onSortsChange` has the whole list. */
  onSortChange?: (sort: DataTableSort | null) => void;
  onSortsChange?: (sorts: readonly DataTableSort[]) => void;
  /** The rows arrive sorted (by a server): the label shows, nothing is re-sorted here. */
  sortedOutside?: boolean;

  /**
   * A grip on each card: long-press and drag, or move from the keyboard or a
   * screen reader. Off while a sort is active, while grouped and in a virtual body.
   */
  reorderable?: boolean;
  onReorder?: (change: DataTableReorder) => void;
  /** Rows that cannot move, by id: a lock in place of the grip. */
  locked?: readonly string[];

  /** Cards under a heading per group, which collapses. */
  groupBy?: (row: T) => string;
  defaultCollapsedGroups?: readonly string[];

  /** Every other card tinted. */
  striped?: boolean;
  /** Skeleton cards while the first page loads. */
  loading?: boolean;
  /** In place of the cards when there are none: an `EmptyState`. */
  empty?: ReactNode;
  /** Above the cards: a search field, filter chips. */
  toolbar?: ReactNode;
  /** Under the cards: a count, pagination. */
  footer?: ReactNode;

  /**
   * Draw only the cards on screen, on FlashList. Off, on, or `'auto'` (the
   * default), which turns itself on past `virtualizeThreshold` rows or when
   * `onEndReached` is set (a table that keeps loading starts virtual, so it
   * never remounts mid-scroll). Ignored while rows are reorderable: a drag
   * needs every row mounted to drop on. A virtual table fills its parent, so
   * give the parent a height.
   */
  virtualize?: boolean | 'auto';
  /** Row count past which `'auto'` virtualizes. */
  virtualizeThreshold?: number;
  /**
   * Near the end of what is loaded: fetch the next page and append it. Not
   * called while `loadingMore` is set, so it cannot fire twice for one page.
   */
  onEndReached?: () => void;
  /** The next page is on its way: a spinner under the last card. */
  loadingMore?: boolean;
  className?: string | undefined;
};

/** A card's title: what the first column usually is, a person or a thing with a line under it. */
export function TableTitle({
  title,
  description,
  avatar,
  leading,
}: {
  title: string;
  description?: string;
  /** A name for an initials avatar. */
  avatar?: string;
  /** Anything else before the title. */
  leading?: ReactNode;
}): React.JSX.Element {
  return (
    <View className="min-w-0 flex-row items-center gap-3">
      {avatar ? <Avatar name={avatar} size={40} decorative /> : leading}
      <View className="min-w-0 shrink">
        <CssText numberOfLines={1} className="text-callout leading-[1.3] font-semibold text-fg">
          {title}
        </CssText>
        {description ? (
          <CssText numberOfLines={1} className="text-[14px] leading-[1.3] text-fg-muted">
            {description}
          </CssText>
        ) : null}
      </View>
    </View>
  );
}

/** One of the bulk bar's buttons: a wash of the bar's ink. */
export function BulkAction({
  children,
  onPress,
  disabled = false,
}: {
  children: string;
  onPress?: () => void;
  /** Greyed: the selection holds something the command cannot act on. */
  disabled?: boolean;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      {...(onPress ? { onPress } : {})}
      className={cn(
        'h-9 items-center justify-center overflow-hidden rounded-full px-3.5',
        disabled && 'opacity-50',
      )}
    >
      <View className="absolute inset-0 bg-fg-on-invert opacity-[0.14]" />
      <CssText className="text-subhead leading-none font-semibold text-fg-on-invert">
        {children}
      </CssText>
    </Pressable>
  );
}

const number = new Intl.NumberFormat('en-GB');

const WEB = Platform.OS === 'web';

/** An empty list that stays the same list, so a default never reads as a change. */
const NONE: readonly string[] = [];

/** "Name A–Z"; with more than one sort, "Team, then start date". */
export function describeSorts<T>(
  sorts: readonly DataTableSort[],
  columns: readonly DataColumn<T>[],
): string {
  const header = (s: DataTableSort): string =>
    columns.find((c) => c.id === s.columnId)?.header ?? s.columnId;
  const [first, ...rest] = sorts;
  if (!first) return '';
  if (rest.length === 0) {
    return `${header(first)} ${first.direction === 'ascending' ? 'A–Z' : 'Z–A'}`;
  }
  return [header(first), ...rest.map((s) => header(s).toLowerCase())].join(', then ');
}

function sortRows<T>(
  rows: readonly T[],
  sorts: readonly DataTableSort[],
  columns: readonly DataColumn<T>[],
): readonly T[] {
  const keys = sorts
    .map((s) => ({ by: columns.find((c) => c.id === s.columnId)?.sortBy, sign: s.direction === 'ascending' ? 1 : -1 }))
    .filter((k): k is { by: (row: T) => string | number; sign: 1 | -1 } => k.by !== undefined);
  if (keys.length === 0) return rows;
  return rows.toSorted((a, b) => {
    for (const { by, sign } of keys) {
      const x = by(a);
      const y = by(b);
      const order =
        typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
      if (order !== 0) return order * sign;
    }
    return 0;
  });
}

function toSortList(
  sort: DataTableSort | readonly DataTableSort[] | null | undefined,
): readonly DataTableSort[] {
  if (sort === null || sort === undefined) return [];
  return 'columnId' in sort ? [sort] : sort;
}

/** Adds an id to a list, or takes it out. */
function toggle(list: readonly string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

/** State a parent may own, or leave to the table. */
function useControlled<V>(
  value: V | undefined,
  initial: V,
  onChange: ((next: V) => void) | undefined,
): [V, (next: V) => void] {
  const [own, setOwn] = useState(initial);
  const current = value ?? own;
  return [
    current,
    (next: V) => {
      setOwn(next);
      onChange?.(next);
    },
  ];
}

/** What the list draws: a group's heading, or a row. Flat, so one FlashList holds both. */
type Item<T> =
  | { kind: 'heading'; key: string; group: string; count: number; open: boolean }
  | {
      kind: 'row';
      key: string;
      row: T;
      id: string;
      /** Its place among every row shown, for striping, moving and a screen reader. */
      index: number;
      /** A hairline above it: not the first of its list or its group. */
      divided: boolean;
    };

/** What every card is drawn from. One object, so a card re-renders when it changes and not otherwise. */
type Look<T> = {
  title: DataColumn<T> | undefined;
  trailing: DataColumn<T> | undefined;
  meta: readonly DataColumn<T>[];
  labelled: boolean;
  renderDetail: ((row: T) => ReactNode) | undefined;
  opens: boolean;
  selectable: boolean;
  moves: boolean;
  striped: boolean;
  locked: readonly string[];
  /** Every row shown: "position 3 of 5,000". */
  setsize: number;
  /** Rows aren't all mounted: each says where it sits. */
  virtual: boolean;
  /** A list of rows. Grouped, the rows sit under headings that are buttons, so not a list. */
  listed: boolean;
  name: (row: T, id: string) => string;
};

/** What a card can ask of the table. Stable for the table's life: it reads the table's current state. */
type Api<T> = {
  press: (row: T, id: string) => void;
  pick: (id: string) => void;
  reorder: (from: number, to: number) => void;
  toggleGroup: (group: string) => void;
};

const keyOf = (item: Item<unknown>): string => item.key;
const typeOf = (item: Item<unknown>): string => item.kind;

export function DataTable<T>({
  rows,
  columns,
  rowId,
  label,
  labelled = false,
  onRowPress,
  describeRow,
  renderDetail,
  expanded: expandedProp,
  defaultExpanded = [],
  onExpandedChange,
  singleExpand = false,
  selectable = false,
  selected: selectedProp,
  defaultSelected = [],
  onSelectedChange,
  bulkActions,
  total,
  sort: sortProp,
  defaultSort,
  onSortChange,
  onSortsChange,
  sortedOutside = false,
  reorderable = false,
  onReorder,
  locked = NONE,
  groupBy,
  defaultCollapsedGroups = [],
  striped = false,
  loading = false,
  empty,
  toolbar,
  footer,
  virtualize = 'auto',
  virtualizeThreshold = 100,
  onEndReached,
  loadingMore = false,
  className,
}: DataTableProps<T>): React.JSX.Element {
  const [expanded, setExpanded] = useControlled(expandedProp, defaultExpanded, onExpandedChange);
  const [selected, setSelected] = useControlled(selectedProp, defaultSelected, onSelectedChange);
  const [sorts, setSorts] = useControlled(
    sortProp === undefined ? undefined : toSortList(sortProp),
    toSortList(defaultSort),
    (next) => {
      onSortsChange?.(next);
      onSortChange?.(next[0] ?? null);
    },
  );
  const [collapsed, setCollapsed] = useState<readonly string[]>(defaultCollapsedGroups);
  const { announce, region } = useAnnouncer();

  const shown = useMemo(
    () => (sortedOutside ? rows : sortRows(rows, sorts, columns)),
    [rows, sorts, columns, sortedOutside],
  );
  const ids = useMemo(() => shown.map(rowId), [shown, rowId]);
  const count = total ?? rows.length;

  // A dragged row means nothing in a sorted or grouped table: the next sort
  // discards it, and a group has its own order.
  const moves = reorderable && sorts.length === 0 && groupBy === undefined;
  // Off while rows move: react-native-sortables, like dnd-kit on the web,
  // needs every row mounted to drop on. A table that keeps loading would
  // pass the threshold mid-scroll and remount what is on screen: it starts on.
  const wants =
    virtualize === 'auto'
      ? shown.length >= virtualizeThreshold || onEndReached !== undefined
      : virtualize;
  const virtual = wants && !moves;

  const items = useMemo((): Item<T>[] => {
    const row = (r: T, index: number, divided: boolean): Item<T> => {
      const id = ids[index] ?? rowId(r);
      return { kind: 'row', key: `r:${id}`, row: r, id, index, divided };
    };
    if (!groupBy) return shown.map((r, i) => row(r, i, i > 0));
    const groups = new Map<string, number[]>();
    shown.forEach((r, i) => {
      const key = groupBy(r);
      const members = groups.get(key);
      if (members) members.push(i);
      else groups.set(key, [i]);
    });
    return [...groups].flatMap(([group, members]): Item<T>[] => {
      const open = !collapsed.includes(group);
      const heading: Item<T> = {
        kind: 'heading',
        key: `g:${group}`,
        group,
        count: members.length,
        open,
      };
      return open
        ? [heading, ...members.map((i, k) => row(shown[i] as T, i, k > 0))]
        : [heading];
    });
  }, [shown, ids, rowId, groupBy, collapsed]);

  const [title, ...others] = columns;
  const look = useMemo((): Look<T> => {
    const trailing = columns.find((c) => c.cardTrailing);
    return {
      title,
      trailing,
      meta: others.filter((c) => c !== trailing && !c.hideOnCard),
      labelled,
      renderDetail,
      opens: renderDetail !== undefined || onRowPress !== undefined,
      selectable,
      moves,
      striped,
      locked,
      setsize: shown.length,
      virtual,
      listed: groupBy === undefined,
      name: (r, id) => describeRow?.(r) ?? (title ? textOf(title.cell(r)) : id),
    };
    // `title` and `others` are `columns` taken apart: covered by `columns`.
  }, [columns, labelled, renderDetail, onRowPress, selectable, moves, striped, locked, shown.length, virtual, groupBy, describeRow]);

  // What a card asks for, against the table's current state: stable, so no
  // card re-renders because the table did.
  const live = useRef({ expanded, selected, collapsed, shown, ids, singleExpand, onRowPress, renderDetail, onReorder, locked, look, setExpanded, setSelected, setCollapsed, announce });
  live.current = { expanded, selected, collapsed, shown, ids, singleExpand, onRowPress, renderDetail, onReorder, locked, look, setExpanded, setSelected, setCollapsed, announce };
  const api = useMemo((): Api<T> => {
    const reorder = (from: number, to: number): void => {
      const now = live.current;
      if (to < 0 || to >= now.shown.length || from === to) return;
      const id = now.ids[from];
      if (id === undefined || now.locked.includes(id) || now.locked.includes(now.ids[to] ?? '')) {
        return;
      }
      now.onReorder?.({ id, from, to, order: move(now.ids, from, to) });
      now.announce(
        `${now.look.name(now.shown[from] as T, id)}, moved to position ${String(to + 1)} of ${String(now.shown.length)}.`,
      );
    };
    return {
      press: (row, id) => {
        const now = live.current;
        if (now.renderDetail) {
          const open = now.expanded.includes(id);
          now.setExpanded(now.singleExpand ? (open ? [] : [id]) : toggle(now.expanded, id));
        } else {
          now.onRowPress?.(row);
        }
      },
      pick: (id) => {
        live.current.setSelected(toggle(live.current.selected, id));
      },
      reorder,
      toggleGroup: (group) => {
        live.current.setCollapsed(toggle(live.current.collapsed, group));
      },
    };
  }, []);

  const open = useMemo(() => new Set(expanded), [expanded]);
  const picked = useMemo(() => new Set(selected), [selected]);
  const flags = useRef({ open, picked });
  flags.current = { open, picked };

  const renderItem = useCallback(
    ({ item }: { item: Item<T> }): React.JSX.Element =>
      item.kind === 'heading' ? (
        <GroupHeading group={item.group} count={item.count} open={item.open} onToggle={api.toggleGroup} />
      ) : (
        <TableCard
          row={item.row}
          id={item.id}
          index={item.index}
          divided={item.divided}
          open={flags.current.open.has(item.id)}
          picked={flags.current.picked.has(item.id)}
          look={look}
          api={api}
        />
      ),
    [look, api],
  );
  // The list draws again when what a card shows changes; each card then
  // decides for itself, so only the rows that changed re-render.
  const drawn = useMemo(() => ({ open, picked }), [open, picked]);
  const sticky = useMemo(
    () => items.flatMap((item, i) => (item.kind === 'heading' ? [i] : [])),
    [items],
  );
  const end = useRef({ onEndReached, loadingMore });
  end.current = { onEndReached, loadingMore };
  // Not while a page is on its way: it could otherwise fire again before the rows arrive.
  const reachedEnd = useCallback(() => {
    if (!end.current.loadingMore) end.current.onEndReached?.();
  }, []);

  const allPicked = ids.length > 0 && ids.every((id) => picked.has(id));
  const all: CheckedState = picked.size === 0 ? false : allPicked ? true : 'indeterminate';

  let body: ReactNode;
  if (loading) {
    body = (
      <View role="progressbar" aria-label={`Loading ${label}`}>
        {Array.from({ length: 5 }, (_, k) => (
          <View key={k} className={cn('flex-row items-center gap-3 p-4', k > 0 && 'border-t border-border')}>
            <Skeleton className="size-10 rounded-full" />
            <View className="flex-1 gap-2">
              <Skeleton className="h-3 w-[55%]" />
              <Skeleton className="h-2.5 w-4/5 rounded-[5px]" />
            </View>
          </View>
        ))}
      </View>
    );
  } else if (shown.length === 0) {
    body = empty;
  } else if (virtual) {
    body = (
      <FlashList
        data={items}
        renderItem={renderItem}
        keyExtractor={keyOf}
        getItemType={typeOf}
        extraData={drawn}
        stickyHeaderIndices={sticky}
        {...(groupBy ? {} : ({ role: 'list', 'aria-label': label } as object))}
        onEndReached={reachedEnd}
        onEndReachedThreshold={0.5}
        ListFooterComponent={loadingMore ? <LoadingMore /> : null}
      />
    );
  } else if (moves) {
    body = (
      <View role="list" aria-label={label}>
        <Sortable.Grid
          data={items}
          columns={1}
          keyExtractor={keyOf}
          customHandle
          {...dragMotion}
          onDragEnd={({ fromIndex, toIndex }) => {
            api.reorder(fromIndex, toIndex);
          }}
          renderItem={renderItem}
        />
      </View>
    );
  } else {
    body = groupBy ? (
      <View aria-label={label}>
        {items.map((item) => (
          <Fragment key={item.key}>{renderItem({ item })}</Fragment>
        ))}
      </View>
    ) : (
      <View role="list" aria-label={label}>
        {items.map((item) => (
          <Fragment key={item.key}>{renderItem({ item })}</Fragment>
        ))}
      </View>
    );
  }

  const sortable = columns.filter((c) => c.sortBy);
  const sortRow =
    sorts.length > 0 && !loading && shown.length > 0 ? (
      <DropdownMenu>
        <DropdownMenuTrigger>
          <Pressable
            accessibilityRole="button"
            accessibilityHint="Changes the order"
            className="min-h-11 flex-row items-center gap-1.5 border-b border-border px-4 py-3"
          >
            <Icon icon={ArrowUpDown} size={15} tone="muted" />
            <CssText className="text-[14px] leading-none font-semibold text-fg-muted">
              {`Sorted by ${describeSorts(sorts, columns)}`}
            </CssText>
          </Pressable>
        </DropdownMenuTrigger>
        <DropdownMenuContent label="Sort by" className="w-64">
          <DropdownMenuLabel>Sort by</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={sorts[0]?.columnId ?? ''}
            onValueChange={(columnId) => {
              const kept = sorts.filter((s) => s.columnId !== columnId);
              setSorts([{ columnId, direction: sorts[0]?.direction ?? 'ascending' }, ...kept]);
            }}
          >
            {sortable.map((c) => (
              <DropdownMenuRadioItem key={c.id} value={c.id}>
                {c.header}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuRadioGroup
            value={sorts[0]?.direction ?? 'ascending'}
            onValueChange={(direction) => {
              const [first, ...rest] = sorts;
              if (first) setSorts([{ ...first, direction: direction as SortDirection }, ...rest]);
            }}
          >
            <DropdownMenuRadioItem value="ascending">Ascending</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="descending">Descending</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    ) : null;

  return (
    <View className={cn('gap-3', virtual && 'flex-1', className)}>
      {toolbar ? <View className="flex-row flex-wrap items-center gap-2">{toolbar}</View> : null}
      <View
        className={cn('overflow-hidden rounded-m-card bg-surface shadow-sm', virtual && 'min-h-0 flex-1')}
      >
        {selectable && !loading && shown.length > 0 ? (
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: all === 'indeterminate' ? 'mixed' : all }}
            aria-checked={all === 'indeterminate' ? 'mixed' : all}
            onPress={() => {
              setSelected(allPicked ? [] : ids);
            }}
            className="min-h-11 flex-row items-center gap-3 border-b border-border px-4 py-3"
          >
            <CheckboxBox checked={all} />
            <CssText className="text-[14px] leading-none font-semibold text-fg-muted">
              Select all
            </CssText>
          </Pressable>
        ) : null}
        {sortRow}
        {body}
        {loadingMore && !virtual ? <LoadingMore /> : null}
      </View>
      {footer ? (
        <View className="flex-row flex-wrap items-center justify-between gap-2 px-1">
          {typeof footer === 'string' ? <Value>{footer}</Value> : footer}
        </View>
      ) : null}
      {selectable && picked.size > 0 ? (
        <View className="flex-row items-center gap-2 rounded-full bg-invert py-1.5 pr-1.5 pl-[18px] shadow-lg">
          <CssText
            role="status"
            className="flex-1 text-[15px] leading-none font-semibold text-fg-on-invert"
          >
            {allPicked && total !== undefined
              ? `All ${number.format(count)} selected`
              : `${number.format(picked.size)} selected`}
          </CssText>
          {bulkActions?.(shown.filter((row) => picked.has(rowId(row))))}
        </View>
      ) : null}
      {region}
    </View>
  );
}

/** A group's heading: its name and count, and it collapses. Sticky in a virtual body. */
const GroupHeading = memo(function GroupHeading({
  group,
  count,
  open,
  onToggle,
}: {
  group: string;
  count: number;
  open: boolean;
  onToggle: (group: string) => void;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      aria-expanded={open}
      onPress={() => {
        onToggle(group);
      }}
      className="min-h-11 flex-row items-center gap-2 bg-surface-sunken px-4 py-3"
    >
      <Icon icon={open ? ChevronDown : ChevronRight} size={15} tone="muted" />
      <CssText className="text-[14px] leading-none font-semibold text-fg">{group}</CssText>
      <CssText className="text-[14px] leading-none font-medium text-fg-muted">{count}</CssText>
    </Pressable>
  );
});

type CardProps<T> = {
  row: T;
  id: string;
  index: number;
  divided: boolean;
  open: boolean;
  picked: boolean;
  look: Look<T>;
  api: Api<T>;
};

/**
 * One row as a card. Memoised on the row and its own flags: selecting or
 * opening one row re-renders that row, not the table.
 */
function TableCardImpl<T>({
  row,
  id,
  index,
  divided,
  open,
  picked,
  look,
  api,
}: CardProps<T>): React.JSX.Element {
  const { title, trailing, meta, labelled, renderDetail, opens, selectable, moves, striped } = look;
  // A cell may build a tree of its own: once per card, not once per use.
  const head = title?.cell(row);
  const name = look.name(row, id);
  const body = (
    <>
      <View className="min-w-0 flex-1 gap-2">
        <View className="min-w-0 flex-row items-center justify-between gap-2.5">
          <View className="min-w-0 flex-1">
            {typeof head === 'string' ? (
              <CssText className="text-callout leading-[1.3] text-fg">{head}</CssText>
            ) : (
              head
            )}
          </View>
          {trailing ? (
            <CssText className="text-[15px] leading-[1.3] font-semibold text-fg tabular-nums">
              {trailing.cell(row)}
            </CssText>
          ) : null}
        </View>
        {meta.length > 0 ? (
          <View className="flex-row flex-wrap items-center gap-x-3.5 gap-y-1.5">
            {meta.map((c) => (
              <View key={c.id} className="min-w-0 flex-row items-center gap-1.5">
                {labelled ? (
                  <CssText className="text-[14px] leading-[1.3] text-fg-subtle">
                    {c.shortHeader ?? c.header}
                  </CssText>
                ) : null}
                <Value>{c.cell(row)}</Value>
              </View>
            ))}
          </View>
        ) : null}
        {open && renderDetail ? (
          <View className="mt-1 rounded-[14px] bg-surface-sunken px-3.5 py-3">
            {renderDetail(row)}
          </View>
        ) : null}
      </View>
      {opens ? (
        <View className="pt-2.5">
          <Icon
            icon={renderDetail ? (open ? ChevronUp : ChevronDown) : ChevronRight}
            size={18}
            tone="subtle"
          />
        </View>
      ) : null}
    </>
  );
  return (
    <View
      // Only a window is mounted: each row says where it sits, or a screen
      // reader would count the handful on screen as the whole table.
      {...(look.listed ? { role: 'listitem' as const } : {})}
      {...(WEB && look.virtual && look.listed
        ? ({ 'aria-setsize': look.setsize, 'aria-posinset': index + 1 } as object)
        : {})}
      className={cn(
        'flex-row items-start gap-3 px-4 py-3.5',
        divided && 'border-t border-border',
        picked
          ? 'bg-accent-subtle'
          : striped && index % 2 === 1
            ? 'bg-surface-sunken/60'
            : 'bg-surface',
      )}
    >
      {selectable ? (
        <Pressable
          accessibilityRole="checkbox"
          accessibilityLabel={`Select ${name}`}
          accessibilityState={{ checked: picked }}
          aria-checked={picked}
          hitSlop={10}
          onPress={() => {
            api.pick(id);
          }}
          className="pt-2"
        >
          <CheckboxBox checked={picked} />
        </Pressable>
      ) : null}
      {moves ? (
        <ReorderHandle
          label={`Move ${name}, position ${String(index + 1)} of ${String(look.setsize)}`}
          locked={look.locked.includes(id)}
          onMove={(delta) => {
            api.reorder(index, index + delta);
          }}
          className="-my-1"
        />
      ) : null}
      {opens ? (
        <Pressable
          accessibilityRole="button"
          {...(renderDetail ? { accessibilityState: { expanded: open }, 'aria-expanded': open } : {})}
          onPress={() => {
            api.press(row, id);
          }}
          className="min-w-0 flex-1 flex-row items-start gap-3"
        >
          {body}
        </Pressable>
      ) : (
        <View className="min-w-0 flex-1 flex-row items-start gap-3">{body}</View>
      )}
    </View>
  );
}

const TableCard = memo(TableCardImpl) as typeof TableCardImpl;

/** A value under the title: text in the card's quiet line, anything else as it is. */
function Value({ children }: { children: ReactNode }): React.JSX.Element {
  const quiet = 'text-[14px] leading-[1.3] text-fg-muted';
  if (typeof children === 'string' || typeof children === 'number') {
    return <CssText className={quiet}>{children}</CssText>;
  }
  if (isValidElement<MoneyProps>(children) && children.type === Money) {
    return cloneElement(children, { className: cn(quiet, children.props.className) });
  }
  return <>{children}</>;
}

function LoadingMore(): React.JSX.Element {
  return (
    <View className="h-[52px] flex-row items-center justify-center gap-2.5">
      <Spinner size={16} decorative />
      <CssText className="text-[14px] leading-none font-medium text-fg-muted">Loading more</CssText>
    </View>
  );
}

/** The plain text of a cell, for the sentences a screen reader hears. */
function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (node && typeof node === 'object' && 'props' in node) {
    const props = node.props as { title?: unknown; children?: ReactNode };
    if (typeof props.title === 'string') return props.title;
    return textOf(props.children);
  }
  if (Array.isArray(node)) return node.map(textOf).join(' ');
  return '';
}
