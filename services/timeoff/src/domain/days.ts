import { Decimal } from 'decimal.js';
import { CalendarDate, DayAmount } from '@kithena/contracts';

/**
 * Day amounts and calendar arithmetic, the two things every Time Off rule
 * computes with.
 *
 * Amounts travel as `DayAmount` strings (three places) and are only ever
 * added up as `Decimal`, because 25/12 as a JS number makes twelve monthly
 * accruals sum to 24.999999999999996 and a ledger that is off by a rounding
 * error is a ledger nobody trusts.
 */

export { Decimal };

/** A stored amount, ready to add up. */
export const days = (value: DayAmount | string): Decimal => new Decimal(value);

/** Back to the stored spelling: three places, and never `-0.000`. */
export function amount(value: Decimal.Value): DayAmount {
  const fixed = new Decimal(value).toFixed(3);
  return DayAmount.parse(fixed === '-0.000' ? '0.000' : fixed);
}

/** The sum of some amounts. */
export const sum = (values: readonly (DayAmount | Decimal)[]): Decimal =>
  values.reduce<Decimal>((total, v) => total.plus(v), new Decimal(0));

/** Rounded up to the nearest half day (PRD §6.2). */
export const ceilHalf = (value: Decimal): Decimal => value.times(2).ceil().div(2);

/** A continuous run of calendar days, both ends included. */
export interface DateRange {
  readonly from: CalendarDate;
  readonly to: CalendarDate;
}

const DAY_MS = 86_400_000;

/**
 * `n` days after `date`. Calendar arithmetic on the date's own UTC midnight, so
 * no zone and no daylight-saving night can move it.
 */
export function addDays(date: CalendarDate, n: number): CalendarDate {
  return CalendarDate.parse(new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10));
}

/** The same day `n` months on. A leave year's months start on its own start day. */
export function addMonths(date: CalendarDate, n: number): CalendarDate {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  return CalendarDate.parse(new Date(Date.UTC(year, month - 1 + n, day)).toISOString().slice(0, 10));
}

/** Calendar days from `from` to `to`, counting both. */
export const daysBetween = (from: CalendarDate, to: CalendarDate): number =>
  (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS + 1;
