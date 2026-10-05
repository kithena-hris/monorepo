/**
 * A place in a list read newest first, a page at a time: when the last row
 * read was made, and its id to break a tie. Review's queues page on it, each
 * kind on its own, so a reader scrolls through every item waiting however
 * many there are, and a page is never more than `QUEUE_PAGE` of them.
 *
 * The place is the last row the store read, not the last one shown: a row
 * the viewer may not see is skipped, and the next page still starts after it.
 */
export interface Keyset {
  readonly at: string;
  readonly id: string;
}

/** A page of one of Review's queues. */
export const QUEUE_PAGE = 50;

const CURSOR = /^(\d{4}-\d{2}-\d{2}T[0-9:.]+Z)~([0-9a-f-]{36})$/u;

/** A cursor as it travels (`2026-09-24T10:00:00.000Z~<uuid>`), or null for none or nonsense. */
export function keysetOf(cursor: string | null | undefined): Keyset | null {
  const m = CURSOR.exec(cursor?.slice(0, 100) ?? '');
  return m === null ? null : { at: m[1] ?? '', id: m[2] ?? '' };
}

export const cursorOf = (place: Keyset): string =>
  `${new Date(place.at).toISOString()}~${place.id}`;

/** Newest first: `a` before `b` when it is later, or as late with the greater id. */
export const newestFirst = (a: Keyset, b: Keyset): number =>
  Date.parse(b.at) - Date.parse(a.at) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

/** Whether `row` comes after `place` in a newest-first list: what the next page holds. */
export const after = (row: Keyset, place: Keyset | null): boolean =>
  place === null || newestFirst(place, row) < 0;
