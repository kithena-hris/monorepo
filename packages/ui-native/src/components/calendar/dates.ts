/*
 * Calendar dates as ISO `YYYY-MM-DD` strings, never a `Date`, as the web's
 * Calendar keeps them: a leave day has no time and no zone, and the moment it
 * becomes a `Date` it takes the device's zone and can land a day out. The
 * arithmetic is done on UTC dates, which never shift.
 */

import { dateOrder } from '../../lib/intl-parts.ts';

export type IsoDate = string;

export type DateRange = { start: IsoDate | null; end: IsoDate | null };

export const MS_PER_DAY = 86_400_000;

/** `2026-10-14` → a UTC timestamp. */
export function parseIsoDate(iso: IsoDate): number {
  const [year, month, day] = iso.split('-').map(Number);
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    Number.isNaN(year) ||
    Number.isNaN(month) ||
    Number.isNaN(day)
  ) {
    throw new TypeError(`Expected an ISO calendar date (YYYY-MM-DD), received "${iso}".`);
  }
  return Date.UTC(year, month - 1, day);
}

export function formatIsoDate(timestamp: number): IsoDate {
  return new Date(timestamp).toISOString().slice(0, 10);
}

export function addDays(iso: IsoDate, days: number): IsoDate {
  return formatIsoDate(parseIsoDate(iso) + days * MS_PER_DAY);
}

/** A month on, the day clamped: 31 January + 1 month is 28 February, not 3 March. */
export function addMonths(iso: IsoDate, months: number): IsoDate {
  const date = new Date(parseIsoDate(iso));
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  const last = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(date.getUTCDate(), last));
  return formatIsoDate(target.getTime());
}

export function startOfMonth(iso: IsoDate): IsoDate {
  return `${iso.slice(0, 7)}-01`;
}

/** 0 Sunday … 6 Saturday. */
export function weekdayOf(iso: IsoDate): number {
  return new Date(parseIsoDate(iso)).getUTCDay();
}

/** Days from `start` to `end`, both counted. */
export function daysBetween(start: IsoDate, end: IsoDate): number {
  return Math.round((parseIsoDate(end) - parseIsoDate(start)) / MS_PER_DAY) + 1;
}

/** The month's days in weeks, `null` where a week runs into the month either side. */
export function monthGrid(month: IsoDate, weekStartsOn: 0 | 1): (IsoDate | null)[][] {
  const first = startOfMonth(month);
  const lead = (weekdayOf(first) - weekStartsOn + 7) % 7;
  const length = new Date(
    Date.UTC(Number(first.slice(0, 4)), Number(first.slice(5, 7)), 0),
  ).getUTCDate();
  const cells: (IsoDate | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length }, (_, i) => addDays(first, i)),
  ];
  while (cells.length % 7) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));
}

/** `14 Oct 2026` in the locale's words, or any other shape `options` asks for. */
export function formatDate(
  iso: IsoDate,
  locale?: string,
  options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' },
): string {
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(
    new Date(parseIsoDate(iso)),
  );
}

const valid = (year: number, month: number, day: number): IsoDate | null => {
  if (month < 1 || month > 12 || day < 1 || year < 1000 || year > 9999) return null;
  const timestamp = Date.UTC(year, month - 1, day);
  const iso = formatIsoDate(timestamp);
  // 31 February rolls over into March: refuse it rather than move the day.
  return Number(iso.slice(8, 10)) === day ? iso : null;
};

/**
 * What people type for a date: `2026-10-14`, `14/10/2026` (or `10/14/2026`,
 * in the locale's order), `14.10.26`, `14 Oct 2026`, `October 14, 2026`.
 * `null` for anything that is not unambiguously one day: a guess that lands on
 * the wrong one is worse than a field that refuses.
 */
export function parseDate(text: string, locale?: string): IsoDate | null {
  const input = text.trim();
  if (!input) return null;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(input);
  if (iso) return valid(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const numeric = /^(\d{1,4})[./\-\s](\d{1,2})[./\-\s](\d{1,4})$/.exec(input);
  if (numeric) {
    const order = dateOrder(locale);
    const parts = [numeric[1], numeric[2], numeric[3]].map(String);
    const get = (type: string): string => parts[order.indexOf(type as 'day')] ?? '';
    const yearText = get('year');
    const year = yearText.length === 2 ? 2000 + Number(yearText) : Number(yearText);
    if (yearText.length !== 2 && yearText.length !== 4) return null;
    return valid(year, Number(get('month')), Number(get('day')));
  }

  // Words: the month's name or its abbreviation, in the locale or in English.
  const words = input.toLocaleLowerCase(locale).replace(/[.,]/g, ' ').split(/\s+/);
  let month: number | undefined;
  const numbers: number[] = [];
  for (const word of words) {
    if (/^\d+$/.test(word)) numbers.push(Number(word));
    else month ??= monthFromName(word, locale);
  }
  const [a, b] = numbers;
  if (month === undefined || a === undefined || b === undefined || numbers.length !== 2)
    return null;
  const [day, year] = a > 31 ? [b, a] : [a, b];
  return valid(year, month, day);
}

function monthFromName(word: string, locale?: string): number | undefined {
  for (const tag of [locale, 'en']) {
    for (const width of ['long', 'short'] as const) {
      const format = new Intl.DateTimeFormat(tag, { month: width, timeZone: 'UTC' });
      for (let m = 0; m < 12; m += 1) {
        const name = format
          .format(new Date(Date.UTC(2026, m, 1)))
          .toLocaleLowerCase(tag)
          .replace(/\./g, '');
        if (name === word || (word.length >= 3 && name.startsWith(word))) return m + 1;
      }
    }
  }
  return undefined;
}
