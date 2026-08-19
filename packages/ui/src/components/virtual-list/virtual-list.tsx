'use client';

import { useVirtualizer } from '@tanstack/react-virtual';
import { useCallback, useRef, type JSX, type ReactNode } from 'react';

import { cn } from '../../lib/cn';

/**
 * A long list with only the visible part in the DOM.
 *
 * ### Why this is a component and not a prop on `ScrollArea`
 *
 * `ScrollArea` takes arbitrary children. A virtualizer has to know how many
 * items there are and roughly how tall each one is, and a container that
 * receives `{children}` cannot know either. Anything claiming to "virtualize a
 * scroll area" is really asking the caller for a list, so this asks for the
 * list directly.
 *
 * ### The count has to survive virtualization
 *
 * Only a window of items is mounted, so the DOM no longer states how many there
 * are. `aria-setsize` and `aria-posinset` carry the real total and position,
 * which is what stops a screen reader announcing "item 3 of 20" in a list of
 * twenty thousand. This is the same reason the virtualized table sets
 * `aria-rowcount`.
 *
 * ### It owns its scroll container
 *
 * Measurement needs the element that actually scrolls. Taking it as a prop
 * would let a caller pass one that does not, and the failure is silent: the
 * window never moves and every item renders anyway.
 */
export interface VirtualListProps<T> {
  items: readonly T[];
  /** Stable identity. An index stops being identity the moment anything sorts. */
  itemKey: (item: T, index: number) => string;
  renderItem: (item: T, index: number) => ReactNode;
  /** Names the list for assistive tech. */
  label: string;
  /**
   * Estimated item height in px, used until an item has been measured. Getting
   * this roughly right only affects scrollbar accuracy before first paint.
   */
  estimateItemHeight?: number;
  /** Items rendered beyond the viewport at each end. */
  overscan?: number;
  /** Shown in place of the list when there is nothing in it. */
  empty?: ReactNode;
  /** Height goes here. Without a bounded height nothing scrolls and nothing virtualizes. */
  className?: string;
  itemClassName?: string;
}

export function VirtualList<T>({
  items,
  itemKey,
  renderItem,
  label,
  estimateItemHeight = 44,
  overscan = 8,
  empty = 'Nothing to show.',
  className,
  itemClassName,
}: VirtualListProps<T>): JSX.Element {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  /*
   * Both callbacks are memoised, and that is not a micro-optimisation.
   *
   * The virtualizer reads its options on every render. Passing a fresh arrow
   * each time makes it treat the configuration as changed, so it recomputes and
   * remeasures; the measurements write back into its state, which renders
   * again, which hands it another new arrow. Idle it settles, but a scroll
   * feeds the loop continuously and the main thread never gets back: forty
   * programmatic scroll steps locked the tab for longer than the tooling was
   * willing to wait.
   */
  const getScrollElement = useCallback(() => scrollRef.current, []);
  const estimateSize = useCallback(() => estimateItemHeight, [estimateItemHeight]);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement,
    estimateSize,
    overscan,
  });

  const virtualItems = virtualizer.getVirtualItems();
  /*
   * Rounded, and given its own unit.
   *
   * React stringifies a numeric `height`, and once a list is long enough that
   * total passes the point where JavaScript prints it in exponential form.
   * `1.11998e+06px` is not a length any browser accepts, so the height was
   * being dropped and the scroll range came from the absolutely positioned
   * children instead.
   */
  const totalHeight = `${String(Math.round(virtualizer.getTotalSize()))}px`;

  if (items.length === 0) {
    return (
      <div
        ref={scrollRef}
        className={cn('overflow-y-auto overscroll-contain', className)}
        tabIndex={0}
        role="region"
        aria-label={label}
      >
        <p className="p-4 text-center text-sm text-fg-muted">{empty}</p>
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      // Focusable for the same reason the table's container is: a region only a
      // mouse can scroll is unreachable from the keyboard.
      tabIndex={0}
      role="region"
      aria-label={label}
      className={cn('overflow-y-auto overscroll-contain', className)}
    >
      <ul role="list" className="relative w-full" style={{ height: totalHeight }}>
        {virtualItems.map((virtualItem) => {
          const item = items[virtualItem.index];
          if (item === undefined) return null;
          return (
            <li
              key={itemKey(item, virtualItem.index)}
              // Measured rather than assumed: `estimateItemHeight` is a first
              // guess, and this replaces it with the real height once painted.
              ref={virtualizer.measureElement}
              data-index={virtualItem.index}
              aria-setsize={items.length}
              aria-posinset={virtualItem.index + 1}
              className={cn('absolute top-0 left-0 w-full', itemClassName)}
              style={{ transform: `translateY(${String(virtualItem.start)}px)` }}
            >
              {renderItem(item, virtualItem.index)}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
