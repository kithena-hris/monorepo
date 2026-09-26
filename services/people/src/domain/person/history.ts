import { err, failure, localDate, ok, type Result } from '@kithena/domain-kit';
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
 * A record's values with `keys` read as they stand on `date`: a row in force
 * that day, a scheduled one included, and otherwise what the record holds —
 * a key nothing recorded yet was in force for keeps its current value.
 */
export function valuesOn(
  values: Readonly<Record<string, unknown>>,
  history: readonly HistoryEntry[],
  keys: readonly string[],
  date: string,
): Record<string, unknown> {
  const out = { ...values };
  for (const key of keys) {
    const entry = valueAsOf(history, key, date);
    if (entry !== undefined) out[key] = entry.value;
  }
  return out;
}

/** UTC−12, where the date is the earliest date anywhere on Earth. */
const LATEST_ZONE = 'Etc/GMT+12';

/**
 * Whether a row was dated after the day it was recorded, somewhere (PEO-124):
 * history when written and the projection only on its day.
 *
 * Judged against the earliest date on Earth at the instant it was recorded,
 * because the person's own day then is not on the row: a row dated the 1st,
 * written at 23:00 UTC on the 30th, was already in force for somebody in
 * Auckland and not for somebody in Los Angeles. Counting both as scheduled
 * costs the first one a visit that finds nothing to do. The same predicate is
 * the partial index the hourly job reads (20260924320000).
 */
export function scheduled(entry: HistoryEntry): boolean {
  return entry.effectiveFrom > localDate(entry.recordedAt, LATEST_ZONE);
}

/**
 * The values that came into force by `today` and the projection does not
 * hold yet (PEO-124, §8.5), earliest effective first.
 *
 * For each key with a scheduled row whose day has come: the value in force
 * today — so of two moves that both arrived only the later one comes in, and
 * a pending value that was corrected comes in as its correction. A value the
 * projection already holds is not an arrival, which is what makes a second
 * run, or a second replica, a no-op. A key with no scheduled row is never
 * touched: its write projected it, and anything that changed the projection
 * since (a retention job clearing it) had its reasons.
 */
export function arrived(
  history: readonly HistoryEntry[],
  keys: readonly string[],
  today: string,
  projection: Readonly<Record<string, unknown>>,
): readonly HistoryEntry[] {
  const due: HistoryEntry[] = [];
  for (const key of keys) {
    const timeline = timelineOf(history, key);
    if (!timeline.some((e) => e.effectiveFrom <= today && scheduled(e))) continue;
    const inForce = timeline.filter((e) => e.effectiveFrom <= today).at(-1);
    if (inForce === undefined || same(inForce.value, projection[key])) continue;
    due.push(inForce);
  }
  return due.toSorted(
    (a, b) =>
      a.effectiveFrom.localeCompare(b.effectiveFrom) || a.recordedAt.localeCompare(b.recordedAt),
  );
}

/** Equal as values: absent is null, and an object's key order is not a difference. */
function same(a: unknown, b: unknown): boolean {
  const canonical = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(canonical)
      : typeof v === 'object' && v !== null
        ? Object.fromEntries(
            Object.entries(v)
              .toSorted(([x], [y]) => x.localeCompare(y))
              .map(([k, x]) => [k, canonical(x)]),
          )
        : (v ?? null);
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
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
