import type { CalendarDate } from '@kithena/contracts';

import { addDays, weekday } from './working-days.js';

/**
 * Holiday calendars, layered (PRD §10.2): national + regional + city, so
 * Madrid is Spain + Comunidad de Madrid + Madrid city. Which layers a location
 * gets is the application's lookup; this resolves layers to days.
 *
 * The weekend rule belongs to the layer and governs that layer's own days.
 * Spain's regions publish their moved days as dates of their own (Madrid's
 * 2 November 2026 is "traslado de Todos los Santos"), so a Spanish layer says
 * `none`; England moves by rule, so its layer says `move_to_monday`.
 */
export interface HolidayLayer {
  readonly key: string;
  readonly name: string;
  readonly level: 'national' | 'regional' | 'city';
  readonly weekendRule: 'move_to_monday' | 'none';
  readonly holidays: readonly { readonly date: CalendarDate; readonly name: string }[];
}

export interface ResolvedHoliday {
  /** The day it is observed, after any move. */
  readonly date: CalendarDate;
  readonly name: string;
  readonly layer: string;
  readonly movedFrom: CalendarDate | null;
}

const isWeekend = (day: CalendarDate): boolean => weekday(day) >= 6;

/** Every holiday observed in `year` across the layers, in date order, one per date. */
export function resolveHolidays(layers: readonly HolidayLayer[], year: number): ResolvedHoliday[] {
  const all = layers.flatMap((l) =>
    l.holidays.map((h) => ({ ...h, layer: l.key, rule: l.weekendRule })),
  );
  const moving = all.filter((h) => h.rule === 'move_to_monday' && isWeekend(h.date));
  const staying = all.filter((h) => !moving.includes(h));

  const byDate = new Map<CalendarDate, ResolvedHoliday>();
  for (const h of staying) {
    if (!byDate.has(h.date))
      byDate.set(h.date, { date: h.date, name: h.name, layer: h.layer, movedFrom: null });
  }
  // In date order, so Christmas takes the Monday before Boxing Day asks for it.
  for (const h of moving.toSorted((a, b) => a.date.localeCompare(b.date))) {
    let day = addDays(h.date, 1);
    while (isWeekend(day) || byDate.has(day)) day = addDays(day, 1);
    byDate.set(day, { date: day, name: h.name, layer: h.layer, movedFrom: h.date });
  }

  const prefix = `${String(year)}-`;
  return [...byDate.values()]
    .filter((h) => h.date.startsWith(prefix))
    .toSorted((a, b) => a.date.localeCompare(b.date));
}

/** The dates alone, for `WorkCalendar.holidays`. */
export const holidayDates = (layers: readonly HolidayLayer[], year: number): Set<CalendarDate> =>
  new Set(resolveHolidays(layers, year).map((h) => h.date));
