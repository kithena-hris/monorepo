/**
 * Calendar dates as days since the epoch, in UTC: a day has no time zone, and
 * a chart computed in local time loses or doubles a day every spring and
 * autumn. Never `new Date()` for "today": the caller says which day it is.
 */
export type IsoDate = string;

const DAY = 86_400_000;

export function dayNumber(iso: IsoDate): number {
  const [year = 0, month = 1, day = 1] = iso.split('-').map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / DAY);
}

export function isoOf(day: number): IsoDate {
  return new Date(day * DAY).toISOString().slice(0, 10);
}

/** 0 for Monday … 6 for Sunday. Day 0 of the epoch was a Thursday. */
export function weekdayOf(day: number): number {
  return (((day + 3) % 7) + 7) % 7;
}

export const WEEKDAYS: readonly string[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/** The ISO week number of a day. */
export function isoWeek(day: number): number {
  const thursday = day - weekdayOf(day) + 3;
  const year = new Date(thursday * DAY).getUTCFullYear();
  const firstThursday = dayNumber(`${String(year)}-01-04`);
  const start = firstThursday - weekdayOf(firstThursday) + 3;
  return 1 + Math.round((thursday - start) / 7);
}

/** "4 Mar": a short date for a readout. */
export function shortDate(day: number): string {
  const date = new Date(day * DAY);
  return `${String(date.getUTCDate())} ${MONTHS[date.getUTCMonth()] ?? ''}`;
}
