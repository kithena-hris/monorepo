import { CalendarDate } from '@kithena/contracts';

/**
 * Calendar arithmetic on a date's own UTC midnight, so no zone and no
 * daylight-saving night moves it. Time Off's and Documents', copied: a module
 * does not import another.
 */

const DAY_MS = 86_400_000;

const parts = (date: string): [number, number, number] =>
  date.split('-').map(Number) as [number, number, number];

const iso = (at: Date): CalendarDate => CalendarDate.parse(at.toISOString().slice(0, 10));

export function addDays(date: CalendarDate, n: number): CalendarDate {
  return iso(new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS));
}

/**
 * The same day `n` months on, clamped to the month's last day: 31 January
 * plus one month is 28 (or 29) February, as a contract lawyer counts it
 * (§ 188(3) BGB; art. 5 Código Civil reads the same).
 */
export function addMonths(date: CalendarDate, n: number): CalendarDate {
  const [y, m, d] = parts(date);
  const target = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  return iso(new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(d, last))));
}

export const addYears = (date: CalendarDate, n: number): CalendarDate => addMonths(date, 12 * n);

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export const daysUntil = (from: CalendarDate, to: CalendarDate): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

/**
 * Whole calendar months from `from` to the day after `to`: a contract from 1
 * January to 30 June is 6 months. Partial months round down.
 */
export function monthsCovered(from: CalendarDate, to: CalendarDate): number {
  const end = addDays(to, 1);
  const [fy, fm, fd] = parts(from);
  const [ty, tm, td] = parts(end);
  const months = (ty - fy) * 12 + (tm - fm);
  return td >= fd ? months : months - 1;
}

/** The calendar date of an instant, in UTC. */
export const dateOf = (instant: string): CalendarDate => CalendarDate.parse(instant.slice(0, 10));

/** Monday to Friday; 0 is Sunday. */
export const isWeekday = (date: CalendarDate): boolean => {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day !== 0 && day !== 6;
};

/** `n` business days after `date`, skipping weekends and the given holidays. */
export function addBusinessDays(
  date: CalendarDate,
  n: number,
  holidays: ReadonlySet<string> = new Set(),
): CalendarDate {
  let at = date;
  let left = n;
  while (left > 0) {
    at = addDays(at, 1);
    if (isWeekday(at) && !holidays.has(at)) left -= 1;
  }
  return at;
}
