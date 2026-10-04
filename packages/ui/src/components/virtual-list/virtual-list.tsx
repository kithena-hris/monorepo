'use client';

import { useVirtualizer, useWindowVirtualizer } from '@tanstack/react-virtual';
import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type JSX,
  type ReactNode,
} from 'react';

import { cn } from '../../lib/cn';
import { Skeleton } from '../feedback/feedback';
import { List } from '../list-item/list-item';

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
 * ### What scrolls
 *
 * By default it owns its scroll container (`scroll="self"`): measurement needs
 * the element that actually scrolls, and taking one as a prop would let a
 * caller pass one that does not, which fails silently. `scroll="page"` is the
 * other honest answer: the list is part of the page and the window scrolls,
 * as a phone's list does.
 *
 * ### Rows of a `List`
 *
 * With `listItems`, `renderItem` returns the row's own `<li>` — a `ListItem`,
 * spreading the third argument onto it — and the list is a `List`: its
 * surface, its hairlines and, with `navigable`, its keyboard. The rows not
 * drawn are space above and below the ones that are, so the rows stay the
 * list's own children, as a `ul` needs.
 *
 * ### Drawn on the server
 *
 * Before anything is measured — on the server, and in the first render in the
 * browser, which must match it — the list assumes a window's height
 * (`initialHeight`) and draws the items that would fill it. A list therefore
 * arrives as its first items, not as an empty box that fills in after
 * hydration.
 *
 * ### Infinite
 *
 * `onEndReached` is called as the reader nears the end of what is loaded, and
 * once at the start when the first page does not fill the view; the caller
 * appends the next page (`usePages`). Each page that lands is said to a
 * screen reader ("20 more loaded").
 */
export interface VirtualRowProps {
  readonly 'data-index': number;
  readonly 'aria-setsize': number;
  readonly 'aria-posinset': number;
}

export interface VirtualListProps<T> {
  items: readonly T[];
  /** Stable identity. An index stops being identity the moment anything sorts. */
  itemKey: (item: T, index: number) => string;
  /** With `listItems`, spread `row` onto the `<li>` returned. */
  renderItem: (item: T, index: number, row: VirtualRowProps) => ReactNode;
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
  /**
   * `self` (the default): the list is a box that scrolls, and `className` must
   * give it a height. `page`: the window scrolls and the list is as tall as
   * its items.
   */
  scroll?: 'self' | 'page';
  /** `renderItem` returns a `ListItem`, and the list is a `List`. */
  listItems?: boolean;
  /** With `listItems`: the rows move from the keyboard, as `List`'s `navigable`. */
  navigable?: boolean;
  /**
   * A grid instead of a column: as many columns as fit at this width (px), as
   * CSS's `repeat(auto-fill, minmax(…, 1fr))` would lay them out. Each row of
   * the grid is one virtual row, as tall as its tallest item.
   */
  minItemWidth?: number;
  /** Space between items, in px: between rows, and between columns in a grid. */
  gap?: number;
  /** The height assumed before anything is measured, on the server and while hydrating. */
  initialHeight?: number;
  /** Near the end of what is loaded: fetch the next page and append it. */
  onEndReached?: () => void;
  /** The next page is on its way: a placeholder in an item's shape sits under the last one. */
  loadingMore?: boolean;
  /** What a screen reader hears as a page lands. */
  moreLoaded?: (added: number) => string;
  /** On a `self` list, the height goes here. Without a bounded height nothing scrolls. */
  className?: string;
  itemClassName?: string;
}

/**
 * A list is a card: one raised surface, the rows inside separated by the
 * hairlines `renderItem` draws. `className` still carries the height, and can
 * strip the surface for a list already inside a panel.
 */
const SURFACE = 'rounded-lg bg-surface shadow-sm';
const SCROLLS =
  'overflow-y-auto overscroll-contain focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-border-focus';

/** How close to the end, in items, the next page is asked for. */
const AHEAD = 10;

const moreLoadedDefault = (added: number): string => `${String(added)} more loaded`;

/** Columns that fit `width`, as CSS `auto-fill` with `minmax(min(100%, min), 1fr)` counts them. */
export function columnsFor(width: number, minItemWidth: number, gap: number): number {
  if (width <= 0) return 1;
  return Math.max(1, Math.floor((width + gap) / (minItemWidth + gap)));
}

/** A length React will not print in exponent form: rounded, never negative. */
const px = (n: number): string => `${String(Math.max(0, Math.round(n)))}px`;

export function VirtualList<T>({
  items,
  itemKey,
  renderItem,
  label,
  estimateItemHeight = 44,
  overscan = 8,
  empty = 'Nothing to show.',
  scroll = 'self',
  listItems = false,
  navigable = false,
  minItemWidth,
  gap = 0,
  initialHeight = 900,
  onEndReached,
  loadingMore = false,
  moreLoaded = moreLoadedDefault,
  className,
  itemClassName,
}: VirtualListProps<T>): JSX.Element {
  const outerRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLElement | null>(null);
  const setList = useCallback((el: HTMLElement | null) => {
    listRef.current = el;
  }, []);
  const page = scroll === 'page';
  const grid = minItemWidth !== undefined;

  // The grid's columns, once the list's width is known. Until then (the
  // server, hydration) a grid is drawn by CSS, which knows the width itself.
  const [columns, setColumns] = useState<number | null>(grid ? null : 1);
  useLayoutEffect(() => {
    const el = listRef.current ?? outerRef.current;
    if (minItemWidth === undefined || el === null) return;
    const measure = (): void => {
      setColumns(columnsFor(el.clientWidth, minItemWidth, gap));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, [minItemWidth, gap]);
  const lanes = columns ?? 1;
  const rows = Math.ceil(items.length / lanes);

  // Where the list starts on the page, for the window's virtualizer.
  const [margin, setMargin] = useState(0);
  useLayoutEffect(() => {
    if (!page) return;
    const measure = (): void => {
      const top = (listRef.current?.getBoundingClientRect().top ?? 0) + window.scrollY;
      setMargin((m) => (Math.abs(m - top) < 1 ? m : top));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(document.body);
    return () => {
      observer.disconnect();
    };
  }, [page]);

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
  const getScrollElement = useCallback(() => outerRef.current, []);
  const estimateSize = useCallback(() => estimateItemHeight, [estimateItemHeight]);
  const initialRect = { width: 0, height: initialHeight };
  const options = { estimateSize, overscan, initialRect, gap };
  // Both, always (hooks are not conditional); the one not scrolling counts nothing.
  const inBox = useVirtualizer({ ...options, count: page ? 0 : rows, getScrollElement });
  const inPage = useWindowVirtualizer({ ...options, count: page ? rows : 0, scrollMargin: margin });
  const virtualizer = page ? inPage : inBox;

  const virtualRows = virtualizer.getVirtualItems();
  const offset = page ? margin : 0;

  // A column's rows are the list's own children: measured where they sit.
  useLayoutEffect(() => {
    if (grid) return;
    const drawn = listRef.current?.querySelectorAll<HTMLElement>(':scope > [data-index]') ?? [];
    for (const li of drawn) virtualizer.measureElement(li);
  });

  // The next page, as the reader nears the end of what is drawn.
  const lastDrawn = virtualRows.at(-1)?.index ?? -1;
  const end = useRef(onEndReached);
  end.current = onEndReached;
  const wantsEnd = onEndReached !== undefined && !loadingMore;
  useEffect(() => {
    if (wantsEnd && rows > 0 && lastDrawn >= rows - 1 - Math.ceil(AHEAD / lanes)) {
      end.current?.();
    }
  }, [wantsEnd, lastDrawn, rows, lanes]);

  // "20 more loaded", as each page lands.
  const [said, setSaid] = useState('');
  const before = useRef(items.length);
  // Infinite once is infinite for the announcement: the last page comes with no next.
  const infinite = useRef(false);
  if (onEndReached !== undefined) infinite.current = true;
  const say = useRef(moreLoaded);
  say.current = moreLoaded;
  useEffect(() => {
    const added = items.length - before.current;
    before.current = items.length;
    if (infinite.current && added > 0) setSaid(say.current(added));
  }, [items.length]);

  const total = virtualizer.getTotalSize();

  const placeholder = loadingMore ? (
    <div aria-busy="true" className="p-3" style={{ height: estimateItemHeight }}>
      <span className="sr-only">Loading more</span>
      <Skeleton className="h-full w-full rounded-md" />
    </div>
  ) : null;

  const outer = (children: ReactNode, surface: boolean): JSX.Element => (
    <div
      ref={outerRef}
      // Focusable for the same reason the table's container is: a region only a
      // mouse can scroll is unreachable from the keyboard.
      {...(page ? {} : { tabIndex: 0 })}
      role="region"
      aria-label={label}
      className={cn(surface && SURFACE, !page && SCROLLS, className)}
    >
      {children}
      {placeholder}
      <span aria-live="polite" className="sr-only">
        {said}
      </span>
    </div>
  );

  if (items.length === 0) {
    return outer(<p className="p-4 text-center text-sm text-fg-muted">{empty}</p>, true);
  }

  const rowProps = (index: number): VirtualRowProps => ({
    'data-index': index,
    'aria-setsize': items.length,
    'aria-posinset': index + 1,
  });

  /* ---------------------------------------------------------- a column -- */
  if (!grid) {
    const first = virtualRows[0];
    const last = virtualRows.at(-1);
    // The rows not drawn, as space: rounded, because React prints a long
    // list's height in exponent form, which no browser accepts as a length.
    const style = {
      paddingTop: px(first === undefined ? 0 : first.start - offset),
      paddingBottom: px(last === undefined ? total : total - (last.end - offset)),
      ...(gap > 0 ? { display: 'flex', flexDirection: 'column' as const, gap } : {}),
    };
    const drawn = virtualRows.map((row) => {
      const it = items[row.index];
      if (it === undefined) return null;
      const key = itemKey(it, row.index);
      return listItems ? (
        <Fragment key={key}>{renderItem(it, row.index, rowProps(row.index))}</Fragment>
      ) : (
        <li key={key} {...rowProps(row.index)} className={itemClassName}>
          {renderItem(it, row.index, rowProps(row.index))}
        </li>
      );
    });
    return listItems
      ? outer(
          <List ref={setList} navigable={navigable} aria-label={label} style={style}>
            {drawn}
          </List>,
          false,
        )
      : outer(
          <ul ref={setList} role="list" aria-label={label} style={style}>
            {drawn}
          </ul>,
          true,
        );
  }

  /* ------------------------------------------------------------ a grid -- */
  const cell = (index: number): ReactNode => {
    const it = items[index];
    if (it === undefined) return null;
    return (
      <div
        key={itemKey(it, index)}
        role="listitem"
        aria-setsize={items.length}
        aria-posinset={index + 1}
        className={cn('min-w-0', itemClassName)}
      >
        {renderItem(it, index, rowProps(index))}
      </div>
    );
  };

  // Not yet measured: CSS lays out the items that would fill the view.
  if (columns === null) {
    // A window's rows of as many columns as a wide screen fits.
    const fill = Math.min(items.length, Math.ceil(initialHeight / estimateItemHeight) * 6);
    return outer(
      <div
        ref={setList}
        role="list"
        aria-label={label}
        className="grid"
        style={{
          gap,
          gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${String(minItemWidth)}px), 1fr))`,
        }}
      >
        {Array.from({ length: fill }, (_, i) => cell(i))}
      </div>,
      false,
    );
  }

  return outer(
    <div
      ref={setList}
      role="list"
      aria-label={label}
      className="relative w-full"
      style={{ height: px(total) }}
    >
      {virtualRows.map((row) => {
        const first = row.index * lanes;
        return (
          <div
            key={row.key}
            // Measured rather than assumed: `estimateItemHeight` is a first
            // guess, and this replaces it with the real height once painted.
            ref={virtualizer.measureElement}
            data-index={row.index}
            role="presentation"
            className="absolute top-0 left-0 grid w-full"
            style={{
              transform: `translateY(${String(row.start - offset)}px)`,
              gap,
              gridTemplateColumns: `repeat(${String(lanes)}, minmax(0, 1fr))`,
            }}
          >
            {Array.from({ length: Math.min(lanes, items.length - first) }, (_, i) =>
              cell(first + i),
            )}
          </div>
        );
      })}
    </div>,
    false,
  );
}
