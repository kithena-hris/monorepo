/**
 * The design's chart data, shared by the chart stories. Deterministic on
 * purpose, as the web's fixtures are: a story drawn from `Math.random()` is a
 * different chart on every compare.
 */
import type { ChartPoint } from '../components/chart/parts.tsx';

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

/** One point a month, the axis printing the month's initial as the phone's does. */
export function byMonth(values: readonly number[], initials = true): ChartPoint[] {
  return values.map((value, i) => {
    const month = MONTHS[i] ?? '';
    return { label: month, value, ...(initials ? { axisLabel: month.charAt(0) } : {}) };
  });
}

/** Points labelled with the month in full words, for the hidden table. */
export function series(values: readonly number[], labels: readonly string[]): ChartPoint[] {
  return values.map((value, i) => ({ label: labels[i] ?? String(i + 1), value }));
}

export const HIRES = [6, 9, 7, 12, 10, 8, 5, 11, 14, 0, 0, 0];
export const HEADCOUNT = [263, 266, 271, 274, 279, 285, 289, 294, 297, 301, 306, 312];
export const PLAN = [263, 268, 273, 278, 283, 288, 293, 298, 303, 308, 313, 318];
export const LEAVERS = [4, 3, 5, 2, 4, 6, 3, 2, 4, 3, 2, 4];

export const TEAMS: ChartPoint[] = [
  { label: 'Engineering', value: 124 },
  { label: 'Sales', value: 64 },
  { label: 'Support', value: 48 },
  { label: 'Design', value: 28 },
  { label: 'Finance', value: 26 },
  { label: 'People', value: 22 },
];

/** Daily active users over 40 days: a gentle wave on a rising line. */
export const DAILY = Array.from({ length: 40 }, (_, i) =>
  Math.round(180 + Math.sin(i / 3) * 18 + i * 2.2),
);

export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;
