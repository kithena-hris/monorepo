import { err, failure, ok, type DomainFailure, type Result } from '@kithena/domain-kit';

import type { PersonSnapshot } from './person.js';

/**
 * Duplicate detection and merge (PEO-074; PRD §12.4). Pure.
 *
 * **Code ranks; a human decides.** Detection is cheap blocking on what two
 * records already share — a unique value's keyed hash, a work email, a name
 * with a date of birth — and the result is a queue, never a merge.
 *
 * **A merge is additive.** Both histories survive where they were written; the
 * absorbed record becomes a tombstone (`merged`) pointing at the survivor, and
 * only the values a reviewer chose are written onto the survivor, as ordinary
 * history rows that a correction can supersede.
 *
 * **Only a record that was never hired is absorbed.** An employment period is
 * payroll history: two of them on one human needs somebody to decide which
 * start date, which number and which pay line are true, and that is not a
 * decision this module makes. So the employed record always survives, and two
 * employed records are refused until that decision has an owner.
 */

export type DuplicateSignal = 'unique_value' | 'work_email' | 'name_and_birth_date';

/** One reason two records look alike, as a query finds it. Ids in either order. */
export interface SignalRow {
  readonly a: string;
  readonly b: string;
  readonly signal: DuplicateSignal;
  /** The unique attribute whose keyed hash two records share; null for the others. */
  readonly attributeKey: string | null;
}

export interface Candidate {
  /** Lower id first, so a pair has one name. */
  readonly personIds: readonly [string, string];
  /** Strongest first. */
  readonly signals: readonly { readonly signal: DuplicateSignal; readonly attributeKey: string | null }[];
}

/**
 * How much a signal says. A unique value held twice is the same human or a
 * typo in a national identifier; a shared work email is usually an account
 * and an HR record for one starter; a name with a birth date is a guess.
 */
const STRENGTH: Record<DuplicateSignal, number> = {
  unique_value: 3,
  work_email: 2,
  name_and_birth_date: 1,
};

/** One name for a pair, whichever way round it is asked. */
export const pairKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** The rows grouped into pairs, the decided ones left out, strongest first. */
export function candidates(rows: readonly SignalRow[], decided: ReadonlySet<string>): Candidate[] {
  const pairs = new Map<string, { ids: [string, string]; signals: Candidate['signals'][number][] }>();
  for (const row of rows) {
    if (row.a === row.b) continue;
    const key = pairKey(row.a, row.b);
    if (decided.has(key)) continue;
    const pair = pairs.get(key) ?? { ids: row.a < row.b ? [row.a, row.b] : [row.b, row.a], signals: [] };
    if (!pair.signals.some((s) => s.signal === row.signal && s.attributeKey === row.attributeKey)) {
      pair.signals.push({ signal: row.signal, attributeKey: row.attributeKey });
    }
    pairs.set(key, pair);
  }
  const score = (signals: Candidate['signals']) =>
    signals.reduce((sum, s) => sum + STRENGTH[s.signal], 0);
  return [...pairs.values()]
    .map(({ ids, signals }) => ({
      personIds: ids,
      signals: signals.toSorted((x, y) => STRENGTH[y.signal] - STRENGTH[x.signal]),
    }))
    .toSorted(
      (x, y) =>
        score(y.signals) - score(x.signals) || pairKey(...x.personIds).localeCompare(pairKey(...y.personIds)),
    );
}

const TOMBSTONES = new Set(['merged', 'discarded']);

/** Why `survivor` may not absorb `absorbed`, or null when it may. */
export function mergeRefusal(survivor: PersonSnapshot, absorbed: PersonSnapshot): DomainFailure | null {
  if (survivor.id === absorbed.id) {
    return failure('SAME_PERSON', 'A record cannot be merged into itself');
  }
  if (TOMBSTONES.has(survivor.status) || TOMBSTONES.has(absorbed.status)) {
    return failure('MERGE_TOMBSTONE', 'A merged or discarded record cannot take part in a merge');
  }
  if (absorbed.status !== 'provisional') {
    return failure(
      'MERGE_ABSORBS_EMPLOYMENT',
      'Only a record that was never hired can be absorbed. Keep the employed record; two employed records cannot be merged',
    );
  }
  if (survivor.identityAccountId !== null && absorbed.identityAccountId !== null) {
    return failure(
      'MERGE_TWO_ACCOUNTS',
      'Both records sign in with an account of their own; one has to be closed in the back office first',
    );
  }
  return null;
}

/**
 * The absorbed record's values for the keys a reviewer chose.
 *
 * `takeable` is what the reviewer may write on the survivor and see on both,
 * less anything sealed or owned by the lifecycle; the application layer
 * computes it. A key the absorbed record holds nothing for is refused rather
 * than read as "clear the survivor's": a merge never deletes a value.
 */
export function valuesTaken(
  take: readonly string[],
  absorbed: Readonly<Record<string, unknown>>,
  takeable: ReadonlySet<string>,
): Result<Record<string, unknown>> {
  const refused = take.filter((k) => !takeable.has(k));
  if (refused.length > 0) {
    return err(failure('FIELD_NOT_WRITABLE', `Not yours to choose: ${refused.join(', ')}`, refused));
  }
  const empty = take.filter((k) => absorbed[k] === undefined || absorbed[k] === null);
  if (empty.length > 0) {
    return err(
      failure('NOTHING_TO_TAKE', `The other record holds nothing for ${empty.join(', ')}`, empty),
    );
  }
  return ok(Object.fromEntries(take.map((k) => [k, absorbed[k]])));
}
