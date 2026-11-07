import { createHash } from 'node:crypto';
import type { CalendarDate } from '@kithena/contracts';

import { de } from '../country-packs/de.js';
import { es } from '../country-packs/es.js';
import { gb } from '../country-packs/gb.js';
import type { HolidayLayer } from '../domain/calendar/holiday-calendar.js';
import { addDays, weekday } from '../domain/calendar/working-days.js';

/**
 * A company's year, made up: the holiday calendars each office keeps, an
 * annual allowance by country, and for every member the time off they took
 * and the days they clocked. Demo data for a seeded company, never a
 * statement of anybody's law: the calendars outside the reviewed country
 * packs are the company's own, and HR edits them like any other.
 *
 * Pure and seeded by the member's id, so a second run plans the same year.
 */

const day = (d: string): CalendarDate => d as CalendarDate;
const days = (list: readonly (readonly [string, string])[]) =>
  list.map(([date, name]) => ({ date: day(date), name }));

const own = (
  key: string,
  name: string,
  level: HolidayLayer['level'],
  list: readonly (readonly [string, string])[],
): HolidayLayer => ({ key, name, level, weekendRule: 'none', holidays: days(list) });

/** The days a US office closes: federal holidays as observed, and the day after Thanksgiving. */
const us = own('us', 'United States', 'national', [
  ['2026-01-01', "New Year's Day"],
  ['2026-01-19', 'Martin Luther King Jr. Day'],
  ['2026-02-16', "Presidents' Day"],
  ['2026-05-25', 'Memorial Day'],
  ['2026-06-19', 'Juneteenth'],
  ['2026-07-03', 'Independence Day (observed)'],
  ['2026-09-07', 'Labor Day'],
  ['2026-10-12', 'Columbus Day'],
  ['2026-11-11', 'Veterans Day'],
  ['2026-11-26', 'Thanksgiving Day'],
  ['2026-11-27', 'Day after Thanksgiving'],
  ['2026-12-25', 'Christmas Day'],
  ['2027-01-01', "New Year's Day"],
  ['2027-01-18', 'Martin Luther King Jr. Day'],
  ['2027-02-15', "Presidents' Day"],
  ['2027-05-31', 'Memorial Day'],
  ['2027-06-18', 'Juneteenth (observed)'],
  ['2027-07-05', 'Independence Day (observed)'],
  ['2027-09-06', 'Labor Day'],
  ['2027-10-11', 'Columbus Day'],
  ['2027-11-11', 'Veterans Day'],
  ['2027-11-25', 'Thanksgiving Day'],
  ['2027-11-26', 'Day after Thanksgiving'],
  ['2027-12-24', 'Christmas Day (observed)'],
  ['2027-12-31', "New Year's Day (observed)"],
]);

/** Ontario's public holidays as observed, and the Civic Holiday most employers give. */
const ontario = own('ca_on', 'Ontario', 'regional', [
  ['2026-01-01', "New Year's Day"],
  ['2026-02-16', 'Family Day'],
  ['2026-04-03', 'Good Friday'],
  ['2026-05-18', 'Victoria Day'],
  ['2026-07-01', 'Canada Day'],
  ['2026-08-03', 'Civic Holiday'],
  ['2026-09-07', 'Labour Day'],
  ['2026-10-12', 'Thanksgiving'],
  ['2026-12-25', 'Christmas Day'],
  ['2026-12-28', 'Boxing Day (observed)'],
  ['2027-01-01', "New Year's Day"],
  ['2027-02-15', 'Family Day'],
  ['2027-03-26', 'Good Friday'],
  ['2027-05-24', 'Victoria Day'],
  ['2027-07-01', 'Canada Day'],
  ['2027-08-02', 'Civic Holiday'],
  ['2027-09-06', 'Labour Day'],
  ['2027-10-11', 'Thanksgiving'],
  ['2027-12-27', 'Christmas Day (observed)'],
  ['2027-12-28', 'Boxing Day (observed)'],
]);

/** Hamburg's own day beside Germany's. */
const hamburg = own('de_hh', 'Hamburg', 'regional', [
  ['2026-10-31', 'Reformationstag'],
  ['2027-10-31', 'Reformationstag'],
]);

/**
 * The Bengaluru office's list. The festivals follow the lunar calendar and
 * are the dates the office announced, which HR corrects here if they move.
 */
const bengaluru = own('in_ka', 'Bengaluru office', 'regional', [
  ['2026-01-14', 'Makara Sankranti'],
  ['2026-01-26', 'Republic Day'],
  ['2026-03-19', 'Ugadi'],
  ['2026-04-03', 'Good Friday'],
  ['2026-05-01', 'May Day'],
  ['2026-08-15', 'Independence Day'],
  ['2026-09-14', 'Ganesh Chaturthi'],
  ['2026-10-02', 'Gandhi Jayanti'],
  ['2026-10-20', 'Vijayadashami'],
  ['2026-11-01', 'Kannada Rajyotsava'],
  ['2026-11-10', 'Deepavali'],
  ['2026-12-25', 'Christmas'],
  ['2027-01-14', 'Makara Sankranti'],
  ['2027-01-26', 'Republic Day'],
  ['2027-03-26', 'Good Friday'],
  ['2027-04-07', 'Ugadi'],
  ['2027-05-01', 'May Day'],
  ['2027-08-15', 'Independence Day'],
  ['2027-09-04', 'Ganesh Chaturthi'],
  ['2027-10-02', 'Gandhi Jayanti'],
  ['2027-10-09', 'Vijayadashami'],
  ['2027-10-29', 'Deepavali'],
  ['2027-11-01', 'Kannada Rajyotsava'],
  ['2027-12-25', 'Christmas'],
]);

const pack = (layers: readonly HolidayLayer[], key: string): HolidayLayer => {
  const found = layers.find((l) => l.key === key);
  if (found === undefined) throw new Error(`No holiday layer ${key} in the packs`);
  return found;
};

/** Every calendar a seeded company keeps. */
export const CALENDARS: readonly HolidayLayer[] = [
  us,
  ontario,
  pack(gb.holidayLayers, 'gb'),
  pack(gb.holidayLayers, 'gb_eaw'),
  pack(de.holidayLayers, 'de'),
  hamburg,
  pack(es.holidayLayers, 'es'),
  pack(es.holidayLayers, 'es_md'),
  pack(es.holidayLayers, 'madrid'),
  bengaluru,
];

/** The calendars an office keeps, most general first, by its country and name. */
export function calendarsFor(country: string | null, place: string): readonly string[] {
  const name = place.toLowerCase();
  switch (country) {
    case 'US':
      return ['us'];
    case 'CA':
      return ['ca_on'];
    case 'GB':
      return ['gb', 'gb_eaw'];
    case 'DE':
      return name.includes('hamburg') ? ['de', 'de_hh'] : ['de'];
    case 'ES':
      return name.includes('madrid') ? ['es', 'es_md', 'madrid'] : ['es'];
    case 'IN':
      return ['in_ka'];
    default:
      return [];
  }
}

/** Annual leave a year, by country: what a company there usually gives. */
export const ALLOWANCE: Readonly<Record<string, number>> = {
  US: 15,
  CA: 15,
  GB: 25,
  DE: 28,
  ES: 23,
  IN: 21,
};

/** A random stream seeded by text: the same member plans the same year. */
export function stream(seed: string): () => number {
  let state = createHash('sha256').update(seed).digest().readUInt32LE(0) || 1;
  return () => {
    // xorshift32
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

const isWorkday = (d: CalendarDate, off: ReadonlySet<string>): boolean =>
  weekday(d) <= 5 && !off.has(d);

/** `n` working days from `from`, as the span's last day, skipping weekends and `off`. */
export function spanOf(from: CalendarDate, n: number, off: ReadonlySet<string>): CalendarDate {
  let to = from;
  let counted = 1;
  while (counted < n) {
    to = addDays(to, 1);
    if (isWorkday(to, off)) counted += 1;
  }
  return to;
}

export interface PlannedLeave {
  readonly kind: 'vacation' | 'sick';
  readonly from: CalendarDate;
  readonly to: CalendarDate;
  /** Left waiting for the manager: a few of the ones still to come. */
  readonly pending: boolean;
}

/**
 * A member's time off for the year: annual leave in a few blocks, most of it
 * already taken and one block still to come, and a sick day or three. Never
 * two on the same day, never on a holiday or before they started.
 */
export function planLeave(input: {
  readonly personId: string;
  readonly allowance: number;
  readonly start: CalendarDate;
  readonly today: CalendarDate;
  readonly yearEnd: CalendarDate;
  readonly holidays: ReadonlySet<string>;
}): PlannedLeave[] {
  const rand = stream(`leave:${input.personId}`);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)] as T;
  const taken = new Set<string>();
  const out: PlannedLeave[] = [];
  const place = (
    kind: PlannedLeave['kind'],
    n: number,
    from: CalendarDate,
    to: CalendarDate,
    pending: boolean,
  ): number => {
    const room = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
    if (room < n + 2) return 0;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      let start = addDays(from, Math.floor(rand() * room));
      while (!isWorkday(start, input.holidays)) start = addDays(start, 1);
      const end = spanOf(start, n, input.holidays);
      if (end > to) continue;
      const span: string[] = [];
      for (let d = start; d <= end; d = addDays(d, 1)) span.push(d);
      // A day's gap either side, so two blocks never read as one.
      if (
        span.some(
          (d) => taken.has(d) || taken.has(addDays(day(d), -1)) || taken.has(addDays(day(d), 1)),
        )
      )
        continue;
      for (const d of span) taken.add(d);
      out.push({ kind, from: start, to: end, pending });
      return n;
    }
    return 0;
  };

  const first = input.start > day('2026-01-02') ? input.start : day('2026-01-02');
  const lastPast = addDays(input.today, -2);
  if (first < lastPast) {
    // Most of the allowance by now, in proportion to the year gone.
    const gone = (Date.parse(input.today) - Date.parse('2026-01-01')) / (365 * 86_400_000);
    let left = Math.round(input.allowance * gone * (0.55 + rand() * 0.4));
    while (left > 0) {
      const n = Math.min(left, pick([1, 1, 2, 3, 5, 5, 10]));
      const placed = place('vacation', n, first, lastPast, false);
      if (placed === 0) break;
      left -= placed;
    }
    for (let i = 0, sick = Math.floor(rand() * 4); i < sick; i += 1) {
      place('sick', pick([1, 1, 2, 3]), first, lastPast, false);
    }
  }
  // One block still to come, now and then waiting for the manager.
  const soon = addDays(input.today, 7);
  if (soon < input.yearEnd && first <= soon) {
    place('vacation', pick([2, 3, 5]), soon, input.yearEnd, rand() < 0.12);
  }
  return out.toSorted((a, b) => a.from.localeCompare(b.from));
}

export interface PlannedPunch {
  readonly kind: 'in' | 'break_start' | 'break_end' | 'out';
  /** Minutes after local midnight. */
  readonly minute: number;
}

/**
 * One working day's punches: in between half past eight and half past nine,
 * a half-hour lunch, out after eight hours or so, a long day now and then;
 * and, rarely and only lately, a clock-out somebody forgot.
 */
export function planDay(personId: string, date: CalendarDate, recent: boolean): PlannedPunch[] {
  const rand = stream(`day:${personId}:${date}`);
  const inAt = 510 + Math.floor(rand() * 60);
  const lunch = 735 + Math.floor(rand() * 45);
  const lunchFor = 30 + Math.floor(rand() * 16);
  const long = rand() < 0.08 ? 60 + Math.floor(rand() * 90) : 0;
  const outAt = inAt + 480 + lunchFor + Math.floor(rand() * 40) - 15 + long;
  const punches: PlannedPunch[] = [
    { kind: 'in', minute: inAt },
    { kind: 'break_start', minute: lunch },
    { kind: 'break_end', minute: lunch + lunchFor },
  ];
  if (!(recent && rand() < 0.01)) punches.push({ kind: 'out', minute: outAt });
  return punches;
}

/** The instant a local wall time is in a zone: offset found from the zone itself. */
export function instantIn(date: CalendarDate, minute: number, timeZone: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const guess = Date.UTC(y, m - 1, d, Math.floor(minute / 60), minute % 60);
  const offset = (at: number): number => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).formatToParts(new Date(at));
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute')) - at;
  };
  const first = guess - offset(guess);
  return new Date(guess - offset(first)).toISOString();
}
