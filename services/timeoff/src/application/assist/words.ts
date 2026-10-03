/**
 * How Time Off's templates say a date, the way the screens do
 * (`apps/web/timeoff/src/words.ts`), so a templated line and a drawn label
 * read alike. Calendar dates are read in UTC, so no zone moves them a day.
 */

const format = (options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-GB', { ...options, timeZone: 'UTC' });
const asDate = (date: string): Date => new Date(`${date}T00:00:00Z`);

/** "8 Dec". */
export const dayMonth = (date: string): string =>
  format({ day: 'numeric', month: 'short' }).format(asDate(date));
/** "Mon 7 Dec". */
export const shortDate = (date: string): string =>
  format({ weekday: 'short', day: 'numeric', month: 'short' }).format(asDate(date));
/** "Wed 21". */
export const dayName = (date: string): string =>
  format({ weekday: 'short', day: 'numeric' }).format(asDate(date));
/** "October". */
export const monthName = (date: string): string => format({ month: 'long' }).format(asDate(date));

/** "19–23 Oct", "28 Dec – 3 Jan", "4 Sep". */
export function spanLabel(from: string, to: string): string {
  if (from === to) return dayMonth(from);
  return from.slice(0, 7) === to.slice(0, 7)
    ? `${format({ day: 'numeric' }).format(asDate(from))}–${dayMonth(to)}`
    : `${dayMonth(from)} – ${dayMonth(to)}`;
}

/** "Omar", "Omar and Yuki", "Omar, Yuki and Leo". */
export function listOf(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1) ?? ''}`;
}

/** "1 day", "4 days", "1.5 days": an amount as Time Off stores it, said. */
export function dayCount(value: string | number): string {
  const n = String(value)
    .replace(/(\.\d*?)0+$/u, '$1')
    .replace(/\.$/u, '');
  return `${n} ${n === '1' ? 'day' : 'days'}`;
}

/** "HH:MM" from minutes after midnight. */
export const clock = (minutes: number): string =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
