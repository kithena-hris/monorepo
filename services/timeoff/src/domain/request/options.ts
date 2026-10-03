import type { CalendarDate } from '@kithena/contracts';

import type { DateRange } from '../days.js';
import { addDays, datesIn, isWorkingDay, type WorkCalendar } from '../calendar/working-days.js';

/**
 * Date options for "describe it" (PRD §14.2, T4, MT8): what the person asked
 * for — about N working days, inside a window, ideally next to a holiday,
 * ideally not leaving the team short — turned into real ranges and scored.
 *
 * Every run of N−1 to N+1 working days starting inside the window is a
 * candidate, never one touching a day already booked. Its score is the days
 * away per day used; a holiday inside the break adds one when wanted, and a
 * day it would leave the team below its minimum takes three off when the
 * person asked to avoid that (half a point otherwise, so it still sorts below
 * an equal one that does not). The best three that do not overlap, best
 * first, then soonest.
 */

/** The team on one day without this person's request: "7 of 7 in, 5 needed". */
export interface TeamDay {
  readonly in: number;
  readonly of: number;
  readonly required: number;
  /** Whether anyone was due to work. */
  readonly checked: boolean;
}

export interface DateOption {
  readonly from: CalendarDate;
  readonly to: CalendarDate;
  readonly used: number;
  readonly away: { readonly from: CalendarDate; readonly to: CalendarDate; readonly days: number };
  readonly holidays: readonly CalendarDate[];
  /** The days it would leave the team below its minimum, with this person away too. */
  readonly short: readonly {
    readonly date: CalendarDate;
    readonly in: number;
    readonly of: number;
    readonly required: number;
  }[];
  /** The fewest in on any of its days, with this person away; `null` with no minimum. */
  readonly fewest: { readonly in: number; readonly of: number } | null;
  readonly score: number;
}

export function dateOptions(args: {
  readonly calendar: WorkCalendar;
  readonly window: DateRange;
  readonly days: number;
  readonly booked: readonly DateRange[];
  readonly team: ReadonlyMap<CalendarDate, TeamDay>;
  readonly nextToHoliday: boolean;
  readonly avoidShort: boolean;
}): DateOption[] {
  const { calendar, team } = args;
  const working = (day: CalendarDate) => isWorkingDay(day, calendar);
  const lengths = [args.days - 1, args.days, args.days + 1].filter((n) => n >= 1);
  const candidates: DateOption[] = [];
  for (const start of datesIn(args.window.from, args.window.to).filter(working)) {
    for (const n of lengths) {
      let to = start;
      for (let count = 1; count < n;) {
        to = addDays(to, 1);
        if (working(to)) count += 1;
      }
      if (to > args.window.to) continue;
      if (args.booked.some((b) => b.from <= to && start <= b.to)) continue;
      let from = start;
      while (!working(addDays(from, -1)) && from > addDays(start, -14)) from = addDays(from, -1);
      let end = to;
      while (!working(addDays(end, 1)) && end < addDays(to, 14)) end = addDays(end, 1);
      const awayDays = datesIn(from, end).length;
      const holidays = datesIn(from, end).filter((day) => calendar.holidays.has(day));
      const mine = datesIn(start, to).filter(working);
      const counted = mine.flatMap((date) => {
        const t = team.get(date);
        return t?.checked === true ? [{ date, in: t.in - 1, of: t.of, required: t.required }] : [];
      });
      const short = counted.filter((t) => t.in < t.required);
      const fewest = counted.toSorted((a, b) => a.in - b.in)[0];
      const score =
        awayDays / n +
        (args.nextToHoliday && holidays.length > 0 ? 1 : 0) -
        (short.length > 0 ? (args.avoidShort ? 3 : 0.5) : 0);
      candidates.push({
        from: start,
        to,
        used: n,
        away: { from, to: end, days: awayDays },
        holidays,
        short,
        fewest: fewest === undefined ? null : { in: fewest.in, of: fewest.of },
        score,
      });
    }
  }
  const picked: DateOption[] = [];
  for (const c of candidates.toSorted(
    (a, b) => b.score - a.score || a.from.localeCompare(b.from),
  )) {
    if (picked.some((p) => p.away.from <= c.away.to && c.away.from <= p.away.to)) continue;
    picked.push(c);
    if (picked.length === 3) break;
  }
  return picked;
}
