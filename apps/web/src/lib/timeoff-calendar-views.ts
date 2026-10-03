/**
 * What the manager's Time Off screens ask for, worked out from the address
 * before the page is fetched (TOF-068 to TOF-073): which days of the team to
 * read around a request, which month and week the calendar shows, and which
 * waiting request breaks the minimum on the timeline. Plain date arithmetic
 * on calendar dates, in UTC so no zone moves a day.
 */

const DAY_MS = 86_400_000;
const shift = (date: string, days: number): string =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
/** Monday is 0. */
const weekday = (date: string): number => (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
const monday = (date: string): string => shift(date, -weekday(date));
const min = (a: string, b: string): string => (a < b ? a : b);
const max = (a: string, b: string): string => (a > b ? a : b);
const isDate = (value: string | undefined): value is string =>
  value !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));

/**
 * The team around a request (T17, MT16): four days before it to three after
 * at a desk, and the working week it starts in on a phone, read at once.
 */
export function aroundRequest(span: { readonly from: string; readonly to: string }): {
  readonly from: string;
  readonly to: string;
} {
  const week = monday(span.from);
  return { from: min(shift(span.from, -4), week), to: max(shift(span.to, 3), shift(week, 4)) };
}

export interface CalendarWindow {
  /** "2026-10". */
  readonly month: string;
  /** The Monday of the week a phone shows. */
  readonly week: string;
  readonly year: number;
  /** What to read: the month, and the phone's week where it runs into the next or last. */
  readonly from: string;
  readonly to: string;
}

/**
 * Which month, week and year the calendar shows (T12, T13, MT13): `month`,
 * `week` and `year` from the query when they are real ones, else today's.
 * A week given without a month shows the month its Friday is in; a month
 * without a week shows this week when it is in that month, else its first.
 */
export function calendarWindow(
  search: Readonly<Record<string, string>>,
  today: string,
): CalendarWindow {
  const asked = search['month'];
  const week0 = isDate(search['week']) ? monday(search['week']) : null;
  const month =
    asked !== undefined && /^\d{4}-(0[1-9]|1[0-2])$/.test(asked)
      ? asked
      : week0 !== null
        ? shift(week0, 4).slice(0, 7)
        : today.slice(0, 7);
  const first = `${month}-01`;
  const next = new Date(`${first}T00:00:00Z`);
  next.setUTCMonth(next.getUTCMonth() + 1);
  const last = shift(next.toISOString().slice(0, 10), -1);
  const week =
    week0 ??
    (today.slice(0, 7) === month
      ? monday(today)
      : monday(weekday(first) >= 5 ? shift(first, 7 - weekday(first)) : first));
  const year = /^\d{4}$/.test(search['year'] ?? '')
    ? Number(search['year'])
    : Number(today.slice(0, 4));
  return { month, week, year, from: min(first, week), to: max(last, shift(week, 4)) };
}

/**
 * The waiting request that takes the team below its minimum (T15): the one
 * the address names when it does, else the first to start. `null` when no
 * waiting request falls on a day below the minimum.
 */
export function clashOf(
  view: {
    readonly entries: readonly {
      readonly requestId: string;
      readonly status: string;
      readonly span: { readonly from: string; readonly to: string };
    }[];
    readonly coverage: readonly { readonly date: string; readonly below: boolean }[];
  },
  asked: string | undefined,
): string | null {
  const below = view.coverage.filter((c) => c.below).map((c) => c.date);
  const clashing = view.entries
    .filter((e) => e.status === 'pending' || e.status === 'change_pending')
    .filter((e) => below.some((d) => e.span.from <= d && d <= e.span.to))
    .toSorted((a, b) => a.span.from.localeCompare(b.span.from));
  return (clashing.find((e) => e.requestId === asked) ?? clashing[0])?.requestId ?? null;
}
