import type { Counts, Shown } from './model';

/**
 * What the shell's chrome shows of the Inbox on every page (B1–B3): the
 * counts and the first rows of each lane, without any item's detail, so it
 * is small enough to stream into the layout after the page has painted.
 */
export interface InboxPeek {
  readonly counts: Counts;
  readonly todo: readonly Shown[];
  readonly updates: readonly Shown[];
  /** Waiting on others: Home's "Waiting on others" card. */
  readonly requests: readonly Shown[];
  readonly now: string;
  readonly zone: string;
}

const PEEK = 6;

const light = (i: Shown): Shown => ({ ...i, detail: null, message: null });

const byDue = (a: Shown, b: Shown): number =>
  (a.due ?? '9999') < (b.due ?? '9999')
    ? -1
    : (a.due ?? '9999') > (b.due ?? '9999')
      ? 1
      : a.at < b.at
        ? 1
        : -1;

export function peekOf(read: {
  readonly items: readonly Shown[];
  readonly counts: Counts;
  readonly now: string;
  readonly zone: string;
}): InboxPeek {
  return {
    counts: read.counts,
    todo: read.items
      .filter((i) => i.counted)
      .toSorted(byDue)
      .slice(0, PEEK)
      .map(light),
    updates: read.items
      .filter((i) => i.lane === 'update')
      .toSorted((a, b) => (a.at < b.at ? 1 : -1))
      .slice(0, PEEK)
      .map(light),
    requests: read.items
      .filter((i) => i.lane === 'request')
      .toSorted((a, b) => (a.at < b.at ? 1 : -1))
      .slice(0, PEEK)
      .map(light),
    now: read.now,
    zone: read.zone,
  };
}

/** Nothing to show: what the chrome draws when the Inbox cannot be read. */
export const EMPTY_PEEK: InboxPeek = {
  counts: { todo: 0, updates: 0, requests: 0 },
  todo: [],
  updates: [],
  requests: [],
  now: new Date(0).toISOString(),
  zone: 'UTC',
};
