import { err, failure, ok, type Result } from '@kithena/domain-kit';
import type { Actor } from '@kithena/contracts';

/**
 * Effective-dated values, and corrections that are not overwrites.
 *
 * Two dates, always, because HR data is bitemporal: `recordedAt` is when we
 * were told and `effectiveFrom` is when it takes effect in the domain. A
 * promotion entered on the 15th and effective on the 1st needs both, or
 * payroll cannot compute the retroactive delta.
 *
 * **A correction is a new row carrying `supersedes`, never an UPDATE.** The
 * reason is one sentence: a salary typo corrected three months later must not
 * read as a pay cut followed by a raise. The superseded row stays, because
 * "what did we believe in February" is a question an auditor asks when March's
 * payslip was wrong.
 */

export interface HistoryEntry {
  readonly id: string;
  readonly attributeKey: string;
  readonly value: unknown;
  /** When it takes effect in the domain. */
  readonly effectiveFrom: string;
  /** When we recorded it. */
  readonly recordedAt: string;
  /**
   * Who did it: a person, an integration or a system process.
   *
   * On the entry rather than looked up later, because "who changed this" is
   * the first question asked about a value somebody disputes, and an
   * after-the-fact join to a session that has since expired does not answer
   * it.
   */
  readonly actor: Actor;
  /** The entry this one replaces. Null for an ordinary change. */
  readonly supersedes: string | null;
  /**
   * The outbox event this change produced.
   *
   * Null until the write that publishes it, so a row and its event can be
   * tied together when somebody is reading an incident backwards.
   */
  readonly eventId: string | null;
}

export interface RecordedChange {
  readonly id: string;
  readonly attributeKey: string;
  readonly value: unknown;
  readonly effectiveFrom: string;
  readonly recordedAt: string;
  readonly actor: Actor;
  readonly eventId?: string | null;
}

export interface Correction {
  readonly id: string;
  readonly supersedes: string;
  readonly value: unknown;
  readonly recordedAt: string;
  readonly actor: Actor;
  readonly eventId?: string | null;
}

/**
 * Append a dated fact.
 *
 * Returns a new array rather than pushing: a caller holding the history it
 * passed in should still be holding what it passed in, which is what makes a
 * refused write further down the call stack safe.
 */
export function record(
  history: readonly HistoryEntry[],
  change: RecordedChange,
): readonly HistoryEntry[] {
  return [...history, { ...change, supersedes: null, eventId: change.eventId ?? null }];
}

/**
 * Correct a fact that was recorded wrongly.
 *
 * The correction takes effect when the fact it corrects did — that is the
 * whole mechanism. Giving it today's effective date would produce exactly the
 * pay cut followed by a raise this exists to prevent.
 */
export function correct(
  history: readonly HistoryEntry[],
  correction: Correction,
): Result<readonly HistoryEntry[]> {
  const target = history.find((e) => e.id === correction.supersedes);
  if (!target) {
    return err(
      failure('SUPERSEDES_UNKNOWN', `No history entry called ${correction.supersedes}`, [
        'supersedes',
      ]),
    );
  }

  // Two live corrections of one fact is two answers to "what was the salary in
  // March". Correcting a correction is the supported path, and it names the
  // correction rather than the original.
  const already = history.find((e) => e.supersedes === correction.supersedes);
  if (already) {
    return err(
      failure(
        'ALREADY_CORRECTED',
        `${correction.supersedes} was already corrected by ${already.id}; correct ${already.id} instead`,
        ['supersedes'],
      ),
    );
  }

  return ok([
    ...history,
    {
      id: correction.id,
      attributeKey: target.attributeKey,
      value: correction.value,
      effectiveFrom: target.effectiveFrom,
      recordedAt: correction.recordedAt,
      actor: correction.actor,
      supersedes: correction.supersedes,
      eventId: correction.eventId ?? null,
    },
  ]);
}

/**
 * The facts that still stand, in effective order.
 *
 * A row that something supersedes is dropped and its replacement takes its
 * place at the same effective date. Ties on `effectiveFrom` are broken by
 * `recordedAt`, because two facts dated the same day are ordered by which one
 * we were told about last.
 */
export function timelineOf(
  history: readonly HistoryEntry[],
  attributeKey: string,
): readonly HistoryEntry[] {
  const superseded = new Set(
    history.filter((e) => e.supersedes !== null).map((e) => e.supersedes as string),
  );

  return history
    .filter((e) => e.attributeKey === attributeKey && !superseded.has(e.id))
    .toSorted(
      (a, b) =>
        a.effectiveFrom.localeCompare(b.effectiveFrom) || a.recordedAt.localeCompare(b.recordedAt),
    );
}

/**
 * The value in force on a date.
 *
 * `asOf` defaults to today at the caller, not here — a domain function that
 * reads the wall clock cannot answer "what did this look like in March", which
 * is the only reason any of this exists.
 */
export function valueAsOf(
  history: readonly HistoryEntry[],
  attributeKey: string,
  asOf: string,
): HistoryEntry | undefined {
  const timeline = timelineOf(history, attributeKey);
  // Last entry whose effective date has arrived. Half-open from that date: a
  // raise effective on the 1st is in force on the 1st.
  return timeline.filter((e) => e.effectiveFrom <= asOf).at(-1);
}

/**
 * The value now, for an attribute that is not effective-dated.
 *
 * A phone number had no value "as of last March" in any sense payroll cares
 * about, so these keep the correction path — history still records who changed
 * it and when — and lose the dated read. Offered as its own function rather
 * than as a flag on `valueAsOf`, because a caller that passes `asOf` to a
 * field which does not have one is asking a question with no answer.
 */
export function currentValue(
  history: readonly HistoryEntry[],
  attributeKey: string,
): HistoryEntry | undefined {
  return timelineOf(history, attributeKey).at(-1);
}
