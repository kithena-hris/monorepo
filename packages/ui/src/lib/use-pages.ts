'use client';

import { useMemo, useRef, useState } from 'react';

/** One page after the first: its items and the cursor to the one after it, or null at the end. */
export interface LoadedPage<T> {
  readonly items: readonly T[];
  readonly next: string | null;
}

/**
 * The rows of a list that loads as it scrolls: the first page as the server
 * drew it, then each page after it, appended. Hand `loadMore` and `loading`
 * to `DataTable`'s `onEndReached` and `loadingMore` (or `VirtualList`'s).
 *
 * A cursor is asked for once, however many triggers fire together. A page
 * that fails is not asked for again by itself — the end of the list would
 * otherwise ask in a loop — so the list stops where it got to.
 * ponytail: no retry control; reopening the page asks again. A "Try again"
 * at the end is the upgrade if failures turn out to be common.
 *
 * A new first page (the server drew the list
 * again: another filter, a write) starts over, reset while rendering so no
 * render holds the old list's cursor.
 */
export function usePages<T>(
  first: readonly T[],
  next: string | null,
  load: ((cursor: string) => Promise<LoadedPage<T> | null>) | undefined,
): {
  readonly items: readonly T[];
  readonly loadMore: (() => void) | undefined;
  readonly loading: boolean;
} {
  const [more, setMore] = useState<{ items: readonly T[]; next: string | null }>({
    items: [],
    next,
  });
  const [loading, setLoading] = useState(false);
  const [from, setFrom] = useState({ first, next });
  if (from.first !== first || from.next !== next) {
    setFrom({ first, next });
    setMore({ items: [], next });
    setLoading(false);
  }
  const asked = useRef<{ first: readonly T[]; cursors: Set<string> }>({
    first,
    cursors: new Set(),
  });
  const cursor = more.next;
  const loadMore =
    load === undefined || cursor === null
      ? undefined
      : () => {
          if (asked.current.first !== first) asked.current = { first, cursors: new Set() };
          if (asked.current.cursors.has(cursor)) return;
          asked.current.cursors.add(cursor);
          setLoading(true);
          void load(cursor).then(
            (page) => {
              if (asked.current.first !== first) return;
              setLoading(false);
              if (page === null) return;
              setMore((m) =>
                m.next !== cursor ? m : { items: [...m.items, ...page.items], next: page.next },
              );
            },
            () => {
              setLoading(false);
            },
          );
        };
  const items = useMemo(
    () => (more.items.length === 0 ? first : [...first, ...more.items]),
    [first, more.items],
  );
  return {
    items,
    loadMore,
    loading,
  };
}
