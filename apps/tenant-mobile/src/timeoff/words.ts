/**
 * How the screens say what Time Off sends, as the web's `timeoff/src/words.ts`:
 * amounts, leave types' icons and colours, and dates, so a date reads the
 * same on every screen.
 */

export type Tone =
  'chart-1' | 'chart-2' | 'chart-3' | 'chart-4' | 'chart-5' | 'chart-6' | 'neutral';

/** A leave type's colour as a series tone; the calendar's two greys are neutral. */
export function chartTone(token: string | undefined): Tone {
  return token !== undefined && /^chart-[1-6]$/.test(token) ? (token as Tone) : 'neutral';
}

/** "11.500" as "11.5": a decimal string, never through a float for anything but display. */
export const amount = (value: string): string =>
  value.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');

/** "−1.5" with a true minus, "+2.08" with a plus: a ledger's signed amount. */
export const signed = (value: string): string =>
  value.startsWith('-') ? `−${amount(value.slice(1))}` : `+${amount(value)}`;

/** "1 day", "5 days", "0.5 days". */
export const days = (value: string): string => {
  const n = amount(value);
  return `${n} ${n === '1' ? 'day' : 'days'}`;
};

export const pad = (n: number): string => String(n).padStart(2, '0');

/** Calendar dates are dates: read and written in UTC, so no zone moves them a day. */
const dateFormat = (options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-GB', { ...options, timeZone: 'UTC' });
export const asDate = (date: string): Date => new Date(`${date}T00:00:00Z`);
export const longDate = (date: string): string =>
  dateFormat({ weekday: 'long', day: 'numeric', month: 'long' }).format(asDate(date));
// Hermes writes "Mon, 7 Dec" where browsers write "Mon 7 Dec": the comma goes.
export const shortDate = (date: string): string =>
  dateFormat({ weekday: 'short', day: 'numeric', month: 'short' })
    .format(asDate(date))
    .replace(',', '');
export const monthName = (date: string): string =>
  dateFormat({ month: 'long' }).format(asDate(date));
export const dayMonth = (date: string): string =>
  dateFormat({ day: 'numeric', month: 'short' }).format(asDate(date));

/** "19–23 Oct", "30 Oct – 2 Nov", "4 Sep". */
export function spanLabel(from: string, to: string): string {
  const day = dateFormat({ day: 'numeric' });
  if (from === to) return dayMonth(from);
  return from.slice(0, 7) === to.slice(0, 7)
    ? `${day.format(asDate(from))}–${dayMonth(to)}`
    : `${dayMonth(from)} – ${dayMonth(to)}`;
}

/** "Mon 19 – Fri 23 Oct", "Wed 21 Oct": a span with its weekdays. */
export function longSpan(from: string, to: string): string {
  if (from === to) return shortDate(from);
  const start = dateFormat(
    from.slice(0, 7) === to.slice(0, 7)
      ? { weekday: 'short', day: 'numeric' }
      : { weekday: 'short', day: 'numeric', month: 'short' },
  ).format(asDate(from));
  return `${start} – ${shortDate(to)}`;
}

export const daysBetween = (from: string, to: string): number =>
  Math.round((asDate(to).getTime() - asDate(from).getTime()) / 86_400_000);

export const addDays = (date: string, n: number): string => {
  const d = asDate(date);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** The weekday after `date`. ponytail: Monday to Friday, until the member's own pattern crosses. */
export function nextWorkingDay(date: string): string {
  let next = addDays(date, 1);
  while ([0, 6].includes(asDate(next).getUTCDay())) next = addDays(next, 1);
  return next;
}

/** "Today", "Tomorrow", "In 11 days", "Yesterday", "3 days ago". */
export function relativeDay(today: string, date: string): string {
  const n = daysBetween(today, date);
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  return n > 0 ? `In ${String(n)} days` : `${String(-n)} days ago`;
}

export type StatusTone = 'success' | 'warning' | 'neutral' | 'info' | 'danger';

/** A request's status as a person reads it (PRD §8.1). */
const STATUS: Record<string, { readonly label: string; readonly tone: StatusTone }> = {
  pending: { label: 'Waiting for approval', tone: 'warning' },
  approved: { label: 'Approved', tone: 'success' },
  counter_proposed: { label: 'New dates suggested', tone: 'info' },
  change_pending: { label: 'Change waiting', tone: 'warning' },
  taken: { label: 'Taken', tone: 'neutral' },
  declined: { label: 'Declined', tone: 'danger' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
  withdrawn: { label: 'Withdrawn', tone: 'neutral' },
};

export const statusOf = (status: string): { readonly label: string; readonly tone: StatusTone } =>
  STATUS[status] ?? { label: status, tone: 'neutral' };

/** A bridge's days to ask for: "Mon 7 Dec", or "9–11 Dec" for more than one. */
export const bridgeDays = (b: { readonly from: string; readonly to: string }): string =>
  b.from === b.to ? shortDate(b.from) : spanLabel(b.from, b.to);
