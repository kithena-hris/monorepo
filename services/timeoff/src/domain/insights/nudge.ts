import type { CalendarDate } from '@kithena/contracts';

import { addDays } from '../days.js';
import { weekday } from '../calendar/working-days.js';

/**
 * What a nudge to rest (T28) may suggest to one person: the next working day
 * that joins a holiday where they work to a weekend — a Tuesday holiday's
 * Monday, a Thursday's Friday — that they have not booked already.
 *
 * ponytail: a Monday-to-Friday week; the member's own pattern and longer
 * bridges come with TOF-085's bridge days in the domain.
 */
export function nextBridge(
  holidays: readonly { readonly date: CalendarDate; readonly name: string }[],
  today: CalendarDate,
  booked: readonly { readonly from: CalendarDate; readonly to: CalendarDate }[],
  /** The last day worth suggesting: the leave year's end, whose days are the ones at stake. */
  until: CalendarDate,
): { take: CalendarDate; from: CalendarDate; to: CalendarDate; holiday: string } | null {
  const off = new Set(holidays.map((h) => h.date));
  for (const h of holidays.toSorted((a, b) => a.date.localeCompare(b.date))) {
    if (h.date <= today || h.date > until) continue;
    const day = weekday(h.date);
    if (day !== 2 && day !== 4) continue;
    const take = addDays(h.date, day === 2 ? -1 : 1);
    if (take <= today || off.has(take) || booked.some((b) => b.from <= take && take <= b.to)) {
      continue;
    }
    return {
      take,
      from: day === 2 ? addDays(h.date, -3) : h.date,
      to: day === 2 ? h.date : addDays(h.date, 3),
      holiday: h.name,
    };
  }
  return null;
}
