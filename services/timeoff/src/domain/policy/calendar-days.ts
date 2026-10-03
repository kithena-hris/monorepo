import type { DayAmount } from '@kithena/contracts';

import { amount, ceilHalf, days } from '../days.js';

/**
 * An allowance written in calendar days, as the working days Time Off counts
 * (PRD §6.4, §7.3, T32): "28 calendar days" on a five-day week is 20 working
 * days. Rounded up to the half day, as every allowance is (§6.2), so nobody
 * loses part of a day to the conversion.
 */
export function workingFromCalendarDays(calendarDays: DayAmount | string, perWeek = 5): DayAmount {
  return amount(ceilHalf(days(calendarDays).times(perWeek).div(7)));
}
