import type { ClockState, Instant, PunchKind } from '@kithena/contracts';

import { ms, shiftsOf, stateOf, type Punch } from './clock.js';

/**
 * A wall kiosk's punch (PRD §11.9). The kiosk knows nothing about the person
 * — not whether they are in — so a tap means the next thing the clock allows
 * at that moment. It may have been taken offline: the kiosk sends the instant
 * of the tap, a sequence it never reuses, and its own time of sending.
 */

/** Beyond this, either way, a kiosk's clock is not trusted and its punches are flagged. */
export const CLOCK_SKEW_SECONDS = 120;

const NEXT: Record<ClockState, PunchKind> = { out: 'in', in: 'out', on_break: 'break_end' };

/** What a tap at `at` does, from the punches that stood before it. */
export function kindAt(punches: readonly Punch[], at: Instant, timeZone: string): PunchKind {
  const before = punches.filter((p) => ms(p.at) < ms(at));
  const shifts = shiftsOf(before, timeZone);
  return NEXT[shifts.ok ? stateOf(shifts.value) : 'out'];
}

/** The items newer than the last synced sequence, oldest first: a replay is nothing new. */
export function unseen<T extends { readonly sequence: number }>(
  last: number,
  items: readonly T[],
): T[] {
  return items.filter((i) => i.sequence > last).toSorted((a, b) => a.sequence - b.sequence);
}

/** How far ahead of the device our clock is when the batch arrives, in seconds. */
export const clockSkew = (sentAt: Instant, receivedAt: Instant): number =>
  Math.round((ms(receivedAt) - ms(sentAt)) / 1000);
