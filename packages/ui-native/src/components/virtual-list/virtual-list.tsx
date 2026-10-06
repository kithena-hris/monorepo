import { FlashList, type FlashListRef } from '@shopify/flash-list';
import {
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from 'react';
import { Platform } from 'react-native';
import { View } from 'react-native-css/components';

import { cn } from '../../lib/cn.ts';

/**
 * A long list with only the visible part mounted, on FlashList: rows are
 * measured as they draw, so heights can vary, and the few cells that exist
 * are recycled as the list scrolls. 20,000 rows cost what twenty do.
 *
 * Only a window is mounted, so the tree stops saying how many rows there are:
 * each row carries the real total and its position, or a screen reader would
 * announce "row 3 of 14" in a list of twenty thousand.
 */

export type VirtualListHandle = {
  /** Scrolls the row at `index` into view. */
  scrollToIndex: (index: number) => void;
};

export type VirtualRow = {
  index: number;
  /** How many rows the list holds, not how many are mounted. */
  setsize: number;
  /** The row the keyboard is on, in a `navigable` list. */
  active: boolean;
};

/** What is drawn right now: for a status line, never for logic. */
export type VirtualWindow = {
  /** Rows mounted: the recycled pool, a couple of dozen at most. */
  rendered: number;
  /** The first row on screen. */
  first: number;
  /** How far down the list, 0 to 1. */
  progress: number;
};

export type VirtualListProps<T> = {
  items: readonly T[];
  itemKey: (item: T, index: number) => string;
  renderItem: (item: T, index: number, row: VirtualRow) => ReactNode;
  /** The list's accessible name. */
  label: string;
  /** The viewport's height. A virtual list scrolls itself, so it needs one. */
  height?: number;
  /** A hairline between rows. On by default. */
  separators?: boolean;
  /** Opens scrolled to this row. */
  initialIndex?: number;
  /** Drawn in place of the rows when there are none: an `EmptyState`. */
  empty?: ReactNode;
  /** Near the end: load the next page. */
  onEndReached?: () => void;
  /** Under the last row while the next page loads. */
  footer?: ReactNode;
  /**
   * Arrow keys move a highlighted row, Home and End jump, Page Down pages,
   * Enter opens. For a hardware keyboard: a tablet's, or the web's.
   */
  navigable?: boolean;
  /** Enter on the highlighted row, in a `navigable` list. */
  onOpen?: (item: T, index: number) => void;
  /** The row the keyboard starts on, in a `navigable` list. */
  defaultActive?: number;
  /** Where the list is, as it scrolls. */
  onWindowChange?: (window: VirtualWindow) => void;
  className?: string | undefined;
  ref?: Ref<VirtualListHandle>;
};

const WEB = Platform.OS === 'web';

/** Arrow and paging keys, as a web keydown names them. */
type Key = { key: string; preventDefault: () => void };

/** Counts mounted cells: FlashList keeps a cell mounted and hands it a new row. */
function Cell({ onMount, children }: { onMount: () => () => void; children: ReactNode }) {
  useEffect(onMount, [onMount]);
  return children;
}

export function VirtualList<T>({
  items,
  itemKey,
  renderItem,
  label,
  height = 360,
  separators = true,
  initialIndex,
  empty,
  onEndReached,
  footer,
  navigable = false,
  onOpen,
  defaultActive,
  onWindowChange,
  className,
  ref,
}: VirtualListProps<T>): React.JSX.Element {
  const list = useRef<FlashListRef<T>>(null);
  const id = useId();
  const [active, setActive] = useState(navigable ? (defaultActive ?? initialIndex ?? 0) : -1);
  const mounted = useRef(0);
  const view = useRef({
    first: initialIndex ?? 0,
    progress: initialIndex && items.length > 1 ? initialIndex / (items.length - 1) : 0,
  });
  const tell = useRef(onWindowChange);
  tell.current = onWindowChange;

  const report = useCallback(() => {
    tell.current?.({ rendered: mounted.current, ...view.current });
  }, []);
  const onMount = useCallback(() => {
    mounted.current += 1;
    report();
    return () => {
      mounted.current -= 1;
    };
  }, [report]);

  useImperativeHandle(ref, () => ({
    scrollToIndex: (index: number) => {
      void list.current?.scrollToIndex({ index, viewPosition: 0.5, animated: true });
    },
  }));

  const count = items.length;
  const move = (to: number): void => {
    const next = Math.max(0, Math.min(count - 1, to));
    setActive(next);
    void list.current?.scrollToIndex({ index: next, viewPosition: 0.5 });
  };
  const onKeyDown = (e: Key): void => {
    const page = Math.max(1, Math.floor(height / 56));
    const step: Record<string, number> = {
      ArrowDown: active + 1,
      ArrowUp: active - 1,
      Home: 0,
      End: count - 1,
      PageDown: active + page,
      PageUp: active - page,
    };
    const to = step[e.key];
    if (to !== undefined) {
      e.preventDefault();
      move(to);
    } else if (e.key === 'Enter' && active >= 0) {
      const item = items[active];
      if (item !== undefined) onOpen?.(item, active);
    }
  };

  if (count === 0) {
    return (
      <View
        className={cn('overflow-hidden rounded-m-card bg-surface p-4 shadow-sm', className)}
      >
        {empty}
      </View>
    );
  }

  const rowId = (index: number): string => `${id}-row-${String(index)}`;
  return (
    <View
      style={{ height }}
      className={cn(
        'overflow-hidden rounded-m-card bg-surface shadow-sm',
        className,
      )}
    >
      <FlashList
        ref={list}
        // The scroller is the list and takes focus, so a keyboard can scroll it (and, navigable, move through it).
        focusable
        role="list"
        aria-label={label}
        {...(navigable && WEB
          ? ({ role: 'listbox', 'aria-activedescendant': rowId(active), onKeyDown } as object)
          : {})}
        data={items}
        keyExtractor={itemKey}
        extraData={active}
        {...(initialIndex !== undefined ? { initialScrollIndex: initialIndex } : {})}
        onEndReached={onEndReached}
        onEndReachedThreshold={0.5}
        onScroll={() => {
          // By row, not by offset: offsets are estimates until every row has been measured.
          const first = list.current?.getFirstVisibleIndex() ?? view.current.first;
          view.current = { first, progress: count > 1 ? first / (count - 1) : 0 };
          report();
        }}
        scrollEventThrottle={64}
        ListFooterComponent={footer ? <>{footer}</> : null}
        renderItem={({ item, index }) => (
          <Cell onMount={onMount}>
            <View
              nativeID={rowId(index)}
              role="listitem"
              {...(WEB
                ? ({
                    'aria-setsize': count,
                    'aria-posinset': index + 1,
                    ...(navigable ? { role: 'option', 'aria-selected': index === active } : {}),
                  } as object)
                : {})}
              className={cn(
                separators && index < count - 1 && 'border-b border-border',
                index === active && 'bg-accent-subtle',
              )}
            >
              {renderItem(item, index, { index, setsize: count, active: index === active })}
            </View>
          </Cell>
        )}
      />
    </View>
  );
}
