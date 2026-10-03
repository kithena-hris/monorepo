import { err, failure, ok, type Result } from '@kithena/domain-kit';

/**
 * A saved segment (PRD §16.3, PEO-068): a named filter, shareable within the
 * tenant, usable in the directory, the export builder and analytics.
 *
 * **A filter, never a result.** It holds attribute keys and the values they
 * must equal, or the directory's conditions on them, and not one person id. Whoever uses it gets the people *they*
 * may list that match it, and a key they may not filter or chart by is
 * refused when they use it — so a segment HR saved over an HR-only field
 * cannot show a manager anybody, and a shared segment is never a way around
 * the permission model. The checks that make that true are the ones every
 * directory filter and chart already runs; this file only says what a
 * segment is.
 *
 * Pure.
 */

export interface Segment {
  readonly id: string;
  readonly name: string;
  /** Attribute key → the value it must equal, as the directory filters. */
  readonly filter: Readonly<Record<string, string>>;
  readonly ownerAccountId: string;
  /** Seen by everybody in the tenant, rather than its owner alone. */
  readonly shared: boolean;
  /**
   * The directory's own conditions, saved from a search ("Save as view"):
   * authorized at use as a typed condition is. Absent on a filter alone.
   */
  readonly conditions?: readonly SegmentCondition[] | undefined;
  /** Whether all of the conditions must hold, or any. */
  readonly match?: 'all' | 'any' | undefined;
}

export interface SegmentCondition {
  readonly key: string;
  readonly op: (typeof OPS)[number];
  readonly values: readonly string[];
}

const OPS = [
  'is',
  'in',
  'not_in',
  'contains',
  'before',
  'after',
  'between',
  'empty',
  'not_empty',
  'under',
] as const;

export type SegmentInput = Pick<Segment, 'name' | 'filter' | 'shared' | 'conditions' | 'match'>;

const KEY = /^[a-z][a-z0-9_]{0,63}$/;
export const MAX_CONDITIONS = 10;

export function checkSegment(input: SegmentInput): Result<SegmentInput> {
  const name = input.name.trim();
  if (name.length === 0 || name.length > 80) {
    return err(failure('SEGMENT_NAME', 'A segment needs a name of up to 80 characters', ['name']));
  }
  const entries = Object.entries(input.filter).map(([k, v]) => [k, v.trim()] as const);
  const conditions = input.conditions ?? [];
  const count = entries.length + conditions.length;
  if (count === 0 || count > MAX_CONDITIONS) {
    return err(
      failure('SEGMENT_FILTER', `A segment filters by 1 to ${String(MAX_CONDITIONS)} fields`, [
        'filter',
      ]),
    );
  }
  for (const [key, value] of entries) {
    // The directory's `key:value,key:value` query cannot carry a comma.
    if (!KEY.test(key) || value.length === 0 || value.length > 200 || value.includes(',')) {
      return err(failure('SEGMENT_FILTER', `${key} is not a condition a segment can hold`, [key]));
    }
  }
  for (const c of conditions) {
    // Its shape only: whether this person may use it is the directory's, at use.
    if (
      !KEY.test(c.key) ||
      !(OPS as readonly string[]).includes(c.op) ||
      c.values.length > 50 ||
      c.values.some((v) => v.length > 200)
    ) {
      return err(
        failure('SEGMENT_FILTER', `${c.key} is not a condition a segment can hold`, [c.key]),
      );
    }
  }
  const filter = Object.fromEntries(entries);
  return ok(
    conditions.length === 0
      ? { name, filter, shared: input.shared }
      : {
          name,
          filter,
          conditions: conditions.map((c) => ({ key: c.key, op: c.op, values: [...c.values] })),
          match: input.match ?? 'all',
          shared: input.shared,
        },
  );
}

/** Its owner sees it; once shared, so does everybody in the tenant. */
export function seenBy(segment: Segment, accountId: string): boolean {
  return segment.shared || segment.ownerAccountId === accountId;
}

/** Only its owner deletes it: sharing lends it, it does not give it away. */
export function mayDelete(segment: Segment, accountId: string): Result<void> {
  return segment.ownerAccountId === accountId
    ? ok(undefined)
    : err(failure('FORBIDDEN', 'Only whoever saved a segment may delete it'));
}
