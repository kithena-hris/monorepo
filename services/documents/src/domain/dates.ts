import { CalendarDate } from '@kithena/contracts';

/**
 * Calendar arithmetic on a date's own UTC midnight, so no zone and no
 * daylight-saving night moves it. Time Off's, copied: a module does not
 * import another.
 */

const DAY_MS = 86_400_000;

export function addDays(date: CalendarDate, n: number): CalendarDate {
  return CalendarDate.parse(
    new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10),
  );
}

/** The same day `n` years on; 29 February lands on 1 March. */
export function addYears(date: CalendarDate, n: number): CalendarDate {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return CalendarDate.parse(new Date(Date.UTC(y + n, m - 1, d)).toISOString().slice(0, 10));
}

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export const daysUntil = (from: CalendarDate, to: CalendarDate): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

/** The calendar date of an instant, in UTC. */
export const dateOf = (instant: string): CalendarDate => CalendarDate.parse(instant.slice(0, 10));
