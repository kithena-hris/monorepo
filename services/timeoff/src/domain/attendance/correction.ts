import type { CalendarDate, Instant } from '@kithena/contracts';

import { ms, type Punch, type Shift } from './clock.js';
import { lastPunchAt, missedClockOut } from './day.js';
import type { Schedule } from './schedule.js';

/**
 * Missed punches and corrections (PRD §11.4; T21, MT18).
 *
 * The correction itself is `AttendanceClock.correct`: a new punch, with
 * `supersedes` when it replaces one and without when the punch was never
 * made. This file is the two questions around it — which days are waiting
 * for one, and which ones the manager has to see.
 */

/** Edits later than this are shown to the manager beside the original. */
export const MANAGER_SEES_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * Days left without a clock-out, for the morning check to ask about.
 *
 * Never closed automatically: "an automatic clock-out can hide real overtime"
 * (T33), so the person is asked when they finished instead.
 */
export function openDays(args: {
  shifts: readonly Shift[];
  schedule: Schedule;
  now: Instant;
  timeZone: string;
}): { date: CalendarDate; lastPunchAt: Instant }[] {
  return args.shifts
    .filter((s) => missedClockOut(s, args.shifts, args.schedule, args.now, args.timeZone))
    .map((s) => ({ date: s.date, lastPunchAt: lastPunchAt(s) }));
}

/**
 * Whether a correction goes in front of the manager.
 *
 * Measured from the earliest moment it is about — the time it claims, or the
 * time of the punch it replaces — so moving a clock-in earlier cannot slip
 * under the line by being made soon after the original. Asked of a
 * correction only: a kiosk replaying a night offline is late too, and is not
 * an edit.
 */
export function needsManager(correction: Punch, punches: readonly Punch[]): boolean {
  const replaced = punches.find((p) => p.id === correction.supersedes);
  const about = Math.min(ms(correction.at), replaced ? ms(replaced.at) : Infinity);
  return ms(correction.recordedAt) - about > MANAGER_SEES_AFTER_MS;
}
