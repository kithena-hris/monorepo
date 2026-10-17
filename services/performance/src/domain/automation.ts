import type { ActivityKind, CalendarDate } from '@kithena/contracts';

import { addDays } from './cycle.js';

/**
 * Automations (PRD §16, PRF-108, PRF-109): cycles made on a calendar, with a
 * lead time, or from an event such as a hire, "3 months after the start,
 * repeated every 3 months, twice", grouped into one cycle per week.
 */

export type Trigger =
  | {
      readonly kind: 'calendar';
      readonly every: 'quarter' | 'half' | 'year';
      /** The month the first occurrence starts in, 1–12. */
      readonly startMonth: number;
      readonly leadDays: number;
    }
  | {
      readonly kind: 'event';
      readonly event: 'hired' | 'probation_end' | 'anniversary';
      readonly offsetDays: number;
      readonly repeatDays: number;
      readonly times: number;
      readonly group: 'week' | 'person';
      readonly leadDays: number;
    };

export interface Automation {
  readonly id: string;
  readonly name: string;
  readonly trigger: Trigger;
  readonly activities: readonly ActivityKind[];
  readonly templates: Readonly<Partial<Record<ActivityKind, string>>>;
  /** Days after the start each activity is due. */
  readonly dueDays: Readonly<Partial<Record<ActivityKind, number>>>;
  readonly skip: readonly ('on_leave' | 'in_review' | 'probation')[];
  readonly paused: boolean;
  readonly created: readonly { readonly key: string; readonly cycleId: string }[];
  readonly by: string;
  readonly at: string;
}

const month = (date: CalendarDate): number => Number(date.slice(5, 7));
const firstOf = (year: number, m: number): CalendarDate =>
  `${String(year)}-${String(m).padStart(2, '0')}-01` as CalendarDate;

/** The next calendar starts on or after `from` (§16.1), `count` of them. */
export function calendarStarts(
  t: Extract<Trigger, { kind: 'calendar' }>,
  from: CalendarDate,
  count: number,
): CalendarDate[] {
  const step = t.every === 'quarter' ? 3 : t.every === 'half' ? 6 : 12;
  const out: CalendarDate[] = [];
  let year = Number(from.slice(0, 4)) - 1;
  let m = t.startMonth;
  while (out.length < count) {
    const d = firstOf(year, m);
    if (d >= from) out.push(d);
    m += step;
    while (m > 12) {
      m -= 12;
      year += 1;
    }
    if (year > Number(from.slice(0, 4)) + 10) break;
  }
  return out;
}

/** The Monday of the week a date falls in: probation reviews share a cycle per week (§16.3). */
export function weekOf(date: CalendarDate): CalendarDate {
  const d = new Date(`${date}T00:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7;
  return addDays(date, -back);
}

/** ISO week number, for "Probation reviews, week 42". */
export function isoWeek(date: CalendarDate): number {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7));
  const jan4 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return (
    1 +
    Math.round(((d.getTime() - jan4.getTime()) / 86_400_000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7)
  );
}

/** Each review date one event makes: offset, then every `repeatDays`, `times` in all. */
export function eventDates(
  t: Extract<Trigger, { kind: 'event' }>,
  on: CalendarDate,
): CalendarDate[] {
  return Array.from({ length: Math.max(1, t.times) }, (_, i) =>
    addDays(on, t.offsetDays + i * t.repeatDays),
  );
}

/** People whose review dates fall in the same week share one cycle (or one each). */
export function groups(
  t: Extract<Trigger, { kind: 'event' }>,
  people: readonly { readonly personId: string; readonly on: CalendarDate }[],
): { readonly key: string; readonly start: CalendarDate; readonly people: readonly string[] }[] {
  const out = new Map<string, { start: CalendarDate; people: string[] }>();
  for (const p of people)
    for (const d of eventDates(t, p.on)) {
      const start = t.group === 'week' ? weekOf(d) : d;
      const key = t.group === 'week' ? start : `${d}:${p.personId}`;
      const g = out.get(key) ?? { start, people: [] };
      g.people.push(p.personId);
      out.set(key, g);
    }
  return [...out]
    .map(([key, g]) => ({ key, ...g }))
    .toSorted((a, b) => a.start.localeCompare(b.start));
}

/** When an automation's cycle is created: `leadDays` before it starts. */
export const createOn = (start: CalendarDate, leadDays: number): CalendarDate =>
  addDays(start, -leadDays);

export { month };
