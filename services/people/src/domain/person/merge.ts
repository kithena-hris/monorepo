import { err, failure, ok, type DomainFailure, type Result } from '@kithena/domain-kit';

import { timelineOf, valueAsOf, type HistoryEntry } from './history.js';

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

export type DuplicateSignal =
  | 'unique_value'
  | 'work_email'
  /** A record a SCIM connection provisioned, and another holding its work email (PEO-072). */
  | 'scim_work_email'
  | 'name_and_birth_date';

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
  readonly signals: readonly {
    readonly signal: DuplicateSignal;
    readonly attributeKey: string | null;
  }[];
}

/**
 * How much a signal says. A unique value held twice is the same human or a
 * typo in a national identifier; a shared work email is usually an account
 * and an HR record for one starter; a name with a birth date is a guess.
 */
const STRENGTH: Record<DuplicateSignal, number> = {
  unique_value: 3,
  work_email: 2,
  scim_work_email: 2,
  name_and_birth_date: 1,
};

/**
 * How strong a match is, in words rather than a percentage: the weights are a
 * ranking, not a probability, and "94%" would claim a precision nobody
 * measured. The bands follow the weights above, summed over a pair's signals:
 *
 * - **strong** (3 or more): a unique value held twice, or two independent
 *   signals that agree (a work email and a name with a birth date).
 * - **likely** (2): a shared work email.
 * - **possible** (1): a name with a birth date, on its own a guess.
 */
export type MatchBand = 'strong' | 'likely' | 'possible';

export function matchBand(signals: Candidate['signals']): MatchBand {
  const score = signals.reduce((sum, s) => sum + STRENGTH[s.signal], 0);
  return score >= 3 ? 'strong' : score === 2 ? 'likely' : 'possible';
}

const scoreOf = (signals: Candidate['signals']): number =>
  signals.reduce((sum, s) => sum + STRENGTH[s.signal], 0);

/**
 * A page of the ranking (`candidates`), `limit` pairs after `place`, and the
 * place of the next page: the last pair's strength and key, so a pair decided
 * in between neither repeats one nor skips one. A place that is not one
 * starts at the top. The ranking must be `candidates`' own, every signal on.
 */
export function duplicatePage(
  ranked: readonly Candidate[],
  place: string | null,
  limit: number,
): { readonly items: readonly Candidate[]; readonly next: string | null } {
  const at = /^(\d+)~(.+)$/u.exec(place ?? '');
  const score = at === null ? null : Number(at[1]);
  const key = at?.[2] ?? '';
  const rest =
    score === null
      ? ranked
      : ranked.filter((c) => {
          const s = scoreOf(c.signals);
          return s < score || (s === score && pairKey(...c.personIds).localeCompare(key) > 0);
        });
  const items = rest.slice(0, limit);
  const last = items.at(-1);
  return {
    items,
    next:
      rest.length > limit && last !== undefined
        ? `${String(scoreOf(last.signals))}~${pairKey(...last.personIds)}`
        : null,
  };
}

/** One name for a pair, whichever way round it is asked. */
export const pairKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** The rows grouped into pairs, the decided ones left out, strongest first. */
export function candidates(rows: readonly SignalRow[], decided: ReadonlySet<string>): Candidate[] {
  const pairs = new Map<
    string,
    { ids: [string, string]; signals: Candidate['signals'][number][] }
  >();
  for (const row of rows) {
    if (row.a === row.b) continue;
    const key = pairKey(row.a, row.b);
    if (decided.has(key)) continue;
    const pair = pairs.get(key) ?? {
      ids: row.a < row.b ? [row.a, row.b] : [row.b, row.a],
      signals: [],
    };
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
        score(y.signals) - score(x.signals) ||
        pairKey(...x.personIds).localeCompare(pairKey(...y.personIds)),
    );
}

const TOMBSTONES = new Set(['merged', 'discarded']);

/** What a merge decision reads of each record; a `PersonSnapshot` is one. */
interface MergeParty {
  readonly id: string;
  readonly status: string;
  readonly identityAccountId: string | null;
}

/** Why `survivor` may not absorb `absorbed`, or null when it may. */
export function mergeRefusal(survivor: MergeParty, absorbed: MergeParty): DomainFailure | null {
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
    return err(
      failure('FIELD_NOT_WRITABLE', `Not yours to choose: ${refused.join(', ')}`, refused),
    );
  }
  const empty = take.filter((k) => absorbed[k] === undefined || absorbed[k] === null);
  if (empty.length > 0) {
    return err(
      failure('NOTHING_TO_TAKE', `The other record holds nothing for ${empty.join(', ')}`, empty),
    );
  }
  return ok(Object.fromEntries(take.map((k) => [k, absorbed[k]])));
}

/** What an undo reads of each record; a `PersonSnapshot` is one. */
interface UnmergeParty extends MergeParty {
  readonly mergedInto?: string | null;
}

/**
 * Why the merge that made `absorbed` a tombstone of `survivor` may not be
 * undone, or null when it may.
 *
 * A survivor that has since been merged away or discarded is refused rather
 * than followed: its values can no longer be corrected, so the undo that
 * comes first is the later one. An erased tombstone has nothing left to give
 * back, and bringing an empty record back to life would be a second person
 * made of nothing.
 */
export function unmergeRefusal(
  absorbed: UnmergeParty,
  survivor: UnmergeParty,
  erased: boolean,
): DomainFailure | null {
  if (absorbed.status !== 'merged' || absorbed.mergedInto !== survivor.id) {
    return failure('UNMERGE_NOT_MERGED', 'This record is not merged into that one');
  }
  if (erased) {
    return failure(
      'UNMERGE_ERASED',
      'The merged record has since been erased under retention; there is nothing to bring back',
    );
  }
  if (TOMBSTONES.has(survivor.status)) {
    return failure(
      'UNMERGE_SURVIVOR_GONE',
      'The record it was merged into has itself been merged or discarded since; undo that first',
    );
  }
  return null;
}

export interface UnmergePlan {
  /** Corrections to write on the survivor: each supersedes the merge's row. */
  readonly reverse: readonly {
    readonly key: string;
    readonly supersedes: string;
    readonly value: unknown;
  }[];
  /** Keys the merge wrote that have changed since: kept as they stand. */
  readonly kept: readonly string[];
}

/**
 * What undoing a merge does to the survivor's values, from the history rows
 * the merge wrote (`taken`, key to row id), the survivor's history now, and
 * the keys the survivor held nothing for before the merge (`emptyBefore`).
 *
 * A row still last on its key's timeline is reversed: corrected, from the
 * day it took effect, to what stood before it — the row in force then, or
 * nothing for a key in `emptyBefore`. A value held before with no row to say
 * what (a record written before history was) is kept: it cannot be guessed. A row
 * anything has come after since (an edit, a correction of it, a change
 * scheduled ahead) is **kept**, not clobbered: somebody decided that value
 * after the merge, and an undo is not a licence to overrule them. A change
 * recorded since but dated before the merge is simply what stood before.
 */
export function unmergePlan(
  taken: Readonly<Record<string, string>>,
  history: readonly HistoryEntry[],
  emptyBefore: ReadonlySet<string>,
): UnmergePlan {
  const reverse: UnmergePlan['reverse'][number][] = [];
  const kept: string[] = [];
  for (const [key, id] of Object.entries(taken)) {
    const row = history.find((e) => e.id === id);
    if (row === undefined || timelineOf(history, key).at(-1)?.id !== id) {
      kept.push(key);
      continue;
    }
    const before = valueAsOf(
      history.filter((e) => e.id !== id),
      key,
      row.effectiveFrom,
    );
    if (before === undefined && !emptyBefore.has(key)) {
      kept.push(key);
      continue;
    }
    reverse.push({ key, supersedes: id, value: before?.value ?? null });
  }
  return { reverse, kept };
}
