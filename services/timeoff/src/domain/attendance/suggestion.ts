import { Instant } from '@kithena/contracts';

/**
 * When somebody probably finished, for a day they forgot to clock out of
 * (PRD §11.4, §14.2; T21, MT18).
 *
 * Only from what they were seen doing — a calendar event's end time, a
 * Kithena action's time — never screen time or location history. Each
 * sighting after the last punch and before the day ends is a candidate,
 * rounded up to the five minutes the time picker offers; two in the same
 * slot are one. Which candidate is the likeliest is the caller's to judge;
 * the latest is the plain answer. Nothing seen, nothing offered.
 */

export interface Sighting {
  readonly source: 'calendar' | 'kithena';
  readonly at: Instant;
}

const FIVE_MINUTES = 5 * 60_000;

export function finishCandidates(args: {
  readonly lastPunchAt: Instant;
  readonly dayEnds: Instant;
  readonly seen: readonly Sighting[];
}): Sighting[] {
  const after = Date.parse(args.lastPunchAt);
  const before = Date.parse(args.dayEnds);
  const slots = new Map<number, Sighting['source']>();
  for (const s of args.seen) {
    const t = Date.parse(s.at);
    if (t <= after || t >= before) continue;
    const slot = Math.ceil(t / FIVE_MINUTES) * FIVE_MINUTES;
    if (!slots.has(slot)) slots.set(slot, s.source);
  }
  return [...slots]
    .toSorted(([a], [b]) => b - a)
    .map(([slot, source]) => ({ at: Instant.parse(new Date(slot).toISOString()), source }));
}
