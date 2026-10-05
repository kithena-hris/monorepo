import { useMemo, useRef, useState } from 'react';

import type { ApprovalItem } from '../approvals/approvals';
import type { ShareRequest } from '../export/export-done';
import type { FullValuesRequest } from '../export/full-values';
import { pairId, type DuplicatePair } from './duplicates';
import { idCheckId, type ReviewItem } from './identifier-reviews';
import type { ReviewState } from './review';

/** One of Review's decision queues, each paged on its own by People. */
export type QueueKind = 'changes' | 'ids' | 'duplicates' | 'access' | 'exports';

/** A page of one queue after a place, as the host reads it. */
export type QueuePage = { readonly items: readonly unknown[]; readonly next: string | null };
export type MoreQueue = (kind: QueueKind, after: string) => Promise<QueuePage | null>;

interface Loaded {
  readonly items: readonly unknown[];
  readonly next: string | null;
}

/** Each queue's item as its row's id: what a page landing twice, or a decision, is matched on. */
const ID: Readonly<Record<QueueKind, (item: never) => string>> = {
  changes: (c: ApprovalItem) => `change-${c.id}`,
  ids: (r: ReviewItem) => `id-${idCheckId(r)}`,
  duplicates: (p: DuplicatePair) => `dup-${pairId(p)}`,
  access: (r: FullValuesRequest) => `access-${r.id}`,
  exports: (s: ShareRequest) => `export-${s.id}`,
};

/** When each was asked for: where a page's place falls in the one newest-first queue. Pairs have none. */
const AT: Readonly<Record<QueueKind, (item: never) => string | null>> = {
  changes: (c: ApprovalItem) => c.requestedAt,
  ids: (r: ReviewItem) => r.enteredAt,
  duplicates: () => null,
  access: (r: FullValuesRequest) => r.requestedAt,
  exports: (s: ShareRequest) => s.requestedAt,
};

const KINDS: readonly QueueKind[] = ['changes', 'ids', 'duplicates', 'access', 'exports'];

/** Each queue's first page, as the page was read. */
function firstPages(state: ReviewState): Record<QueueKind, Loaded> {
  return {
    changes: { items: state.approvals?.items ?? [], next: state.approvals?.itemsNext ?? null },
    ids: { items: state.identifiers?.items ?? [], next: state.identifiers?.next ?? null },
    duplicates: { items: state.duplicates?.items ?? [], next: state.duplicates?.next ?? null },
    access: { items: state.fullValues?.requests ?? [], next: state.fullValues?.next ?? null },
    exports: { items: state.shares ?? [], next: state.sharesNext ?? null },
  };
}

/**
 * Review's queues past their first page: each loads its next page as the
 * list nears its end (`load`), and `state` is the page's state with every
 * page loaded so far in it, so the list and the detail pane read one thing.
 *
 * As Missing details' pages do, a page read again (after a decision, which
 * reads the page again) replaces the first page and keeps the pages after
 * it, so the reader keeps their place; what was decided here (`decided`)
 * leaves the pages kept from before, which the new first page cannot correct.
 *
 * `frontier` is where each queue's loaded pages end: in "All", whose rows
 * are every queue's newest first, nothing older than the latest frontier of
 * a queue with more to load is shown yet, so a page never lands above rows
 * already shown. That queue is the one `All` loads next (`blocking`).
 */
export function useQueuePages(state: ReviewState, onMore: MoreQueue | undefined) {
  const first = useMemo(() => firstPages(state), [state]);
  const [more, setMore] = useState<Partial<Record<QueueKind, Loaded>>>({});
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const [loading, setLoading] = useState<QueueKind | null>(null);
  const asked = useRef(new Set<string>());

  const nextOf = (k: QueueKind): string | null => more[k]?.next ?? first[k].next;
  const hasMore = (k: QueueKind): boolean => onMore !== undefined && nextOf(k) !== null;

  const load = (k: QueueKind): void => {
    const after = nextOf(k);
    if (onMore === undefined || after === null || loading !== null) return;
    const key = `${k}:${after}`;
    if (asked.current.has(key)) return;
    asked.current.add(key);
    setLoading(k);
    void onMore(k, after).then(
      (page) => {
        setLoading(null);
        // Nothing came: not asked again on its own, as Missing details' pages are not.
        if (page === null) return;
        setMore((m) => ({
          ...m,
          [k]: { items: [...(m[k]?.items ?? []), ...page.items], next: page.next },
        }));
      },
      () => {
        setLoading(null);
      },
    );
  };

  const items = useMemo(() => {
    const out = {} as Record<QueueKind, readonly unknown[]>;
    for (const k of KINDS) {
      const seen = new Set<string>();
      const id = ID[k] as (item: unknown) => string;
      // The first page is People's as it stands; a page kept from before is
      // not, and drops what was decided here.
      const kept = (more[k]?.items ?? []).filter((item) => !gone.has(id(item)));
      out[k] = [...first[k].items, ...kept].filter((item) => {
        const key = id(item);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }
    return out;
  }, [first, more, gone]);

  const merged = useMemo(
    (): ReviewState => ({
      ...state,
      approvals:
        state.approvals === null
          ? null
          : { ...state.approvals, items: items.changes as readonly ApprovalItem[] },
      identifiers:
        state.identifiers === null
          ? null
          : { ...state.identifiers, items: items.ids as readonly ReviewItem[] },
      duplicates:
        state.duplicates === null
          ? null
          : { ...state.duplicates, items: items.duplicates as readonly DuplicatePair[] },
      fullValues:
        state.fullValues === null
          ? null
          : { ...state.fullValues, requests: items.access as readonly FullValuesRequest[] },
      shares: state.shares == null ? (state.shares ?? null) : (items.exports as ShareRequest[]),
    }),
    [state, items],
  );

  /** Where a queue's loaded pages end, while it has more: the last loaded item's time. */
  const frontier = (k: QueueKind): string | null => {
    if (!hasMore(k)) return null;
    const loaded = more[k]?.items ?? first[k].items;
    const last = loaded.at(-1);
    return last === undefined ? null : (AT[k] as (item: unknown) => string | null)(last);
  };

  return {
    state: merged,
    load,
    loading,
    hasMore,
    frontier,
    /** A decision went through: its row leaves any page kept from before the page is read again. */
    decided: (rowId: string) => {
      setGone((g) => new Set([...g, rowId]));
    },
  };
}

/**
 * Of the queues `kinds`, the one "All" loads next and the time nothing older
 * than may show yet: the dated queue with more to load whose pages end
 * latest. Undated pairs come after every dated row, so they load last.
 */
export function cutoffOf(
  kinds: readonly QueueKind[],
  pages: Pick<ReturnType<typeof useQueuePages>, 'frontier' | 'hasMore'>,
): { readonly at: string | null; readonly blocking: QueueKind | null; readonly dated: boolean } {
  let at: string | null = null;
  let blocking: QueueKind | null = null;
  for (const k of kinds) {
    const f = k === 'duplicates' ? null : pages.frontier(k);
    if (f !== null && (at === null || f > at)) {
      at = f;
      blocking = k;
    }
  }
  const dated = kinds.some((k) => k !== 'duplicates' && pages.hasMore(k));
  if (blocking === null && kinds.includes('duplicates') && pages.hasMore('duplicates')) {
    blocking = 'duplicates';
  }
  return { at, blocking, dated };
}
