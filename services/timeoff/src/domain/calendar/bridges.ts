import type { CalendarDate } from '@kithena/contracts';

import type { DateRange } from '../days.js';
import { addDays, datesIn, isWorkingDay, type WorkCalendar } from './working-days.js';

/**
 * Bridge days (PRD §14.2, T1, MT1): the working days that join a holiday to
 * the days off around it, so a few days asked for buy a much longer break —
 * a Tuesday holiday's Monday is 1 day for 4.
 *
 * Read from the member's own week and their location's holidays: a run of
 * working days with days off on both sides, at least one side a holiday, no
 * longer than `maxUsed`, and worth it — the break at least two and a half
 * times the days it costs, which keeps a Monday for 4 and four days for 10
 * and drops three days for 6. Never a day already past or already booked.
 *
 * Best value first, then soonest.
 */

export interface Bridge {
  /** The working days to ask for. */
  readonly from: CalendarDate;
  readonly to: CalendarDate;
  readonly used: number;
  /** The whole break, the days off either side included. */
  readonly away: { readonly from: CalendarDate; readonly to: CalendarDate; readonly days: number };
  /** The holidays inside the break. */
  readonly holidays: readonly CalendarDate[];
}

const off = (day: CalendarDate, calendar: WorkCalendar): boolean => !isWorkingDay(day, calendar);

/** The days off running back from `day`, or forward, `day` excluded; a fortnight at most. */
function stretch(day: CalendarDate, step: 1 | -1, calendar: WorkCalendar): CalendarDate[] {
  const out: CalendarDate[] = [];
  for (let next = addDays(day, step); off(next, calendar) && out.length < 14;) {
    out.push(next);
    next = addDays(next, step);
  }
  return out;
}

export function findBridges(
  calendar: WorkCalendar,
  window: DateRange,
  booked: readonly DateRange[],
  maxUsed = 4,
): Bridge[] {
  const found: Bridge[] = [];
  let run: CalendarDate[] = [];
  const close = (): void => {
    const first = run[0];
    const last = run.at(-1);
    run = [];
    if (first === undefined || last === undefined) return;
    const used = datesIn(first, last).length;
    if (used > maxUsed || first < window.from) return;
    if (booked.some((b) => b.from <= last && first <= b.to)) return;
    const before = stretch(first, -1, calendar);
    const after = stretch(last, 1, calendar);
    if (before.length === 0 || after.length === 0) return;
    const holidays = [...before, ...after].filter((day) => calendar.holidays.has(day)).toSorted();
    if (holidays.length === 0) return;
    const from = before.at(-1) ?? first;
    const to = after.at(-1) ?? last;
    const days = datesIn(from, to).length;
    if (days * 2 < used * 5) return;
    found.push({ from: first, to: last, used, away: { from, to, days }, holidays });
  };
  // A run that starts before the window is still read whole, so its first day is checked.
  let day = window.from;
  while (!off(day, calendar)) day = addDays(day, -1);
  for (; day <= window.to; day = addDays(day, 1)) {
    if (off(day, calendar)) close();
    else run.push(day);
  }
  return found.toSorted(
    (a, b) => b.away.days / b.used - a.away.days / a.used || a.from.localeCompare(b.from),
  );
}
