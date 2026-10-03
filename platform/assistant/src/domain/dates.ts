import { CalendarDate, type DateOn, type DateRange, type DateRef } from '@kithena/contracts';
import { isTimeZone, type Clock } from '@kithena/domain-kit';

/**
 * Date references, resolved in the asker's time zone (assistant PRD §9.4).
 * Pure: "now" comes from the injected `Clock`, and every other date is
 * arithmetic on calendar days, so nothing here reads the wall clock.
 *
 * The model writes `next_week`; it is never trusted to do date arithmetic.
 * The assistant resolves it here, in the zone of the account asking, and the
 * answer says the dates it used, so a misreading is visible.
 */

/** Today where the asker is, worked out once per question so every step agrees. */
export interface Today {
  readonly date: CalendarDate;
  readonly zone: string;
  /** The account had no zone the runtime knows, so UTC was used, and the answer says so. */
  readonly utc: boolean;
}

export function todayIn(zone: string | null | undefined, clock: Clock): Today {
  const known = typeof zone === 'string' && isTimeZone(zone);
  const used = known ? zone : 'UTC';
  return { date: clock.date(used), zone: used, utc: !known };
}

/* ------------------------------------------------------- day arithmetic -- */

const DAY_MS = 86_400_000;
const ISO = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', dateStyle: 'short' });

const parts = (d: string): [number, number, number] => [
  Number(d.slice(0, 4)),
  Number(d.slice(5, 7)),
  Number(d.slice(8, 10)),
];
/** Month and day may overflow, as `Date.UTC` allows: month 13 is next January, day 0 the last of the month before. */
const dateOf = (year: number, month: number, day: number): CalendarDate =>
  CalendarDate.parse(ISO.format(Date.UTC(year, month - 1, day)));
const plus = (d: string, days: number): CalendarDate => {
  const [y, m, day] = parts(d);
  return dateOf(y, m, day + days);
};
/** 0 for Monday: 1 January 1970 was a Thursday. */
const weekday = (d: string): number => {
  const [y, m, day] = parts(d);
  return (Math.floor(Date.UTC(y, m - 1, day) / DAY_MS) + 3) % 7;
};

const one = (d: CalendarDate): DateRange => ({ from: d, to: d });

function rangeOf(ref: DateRef, today: CalendarDate): DateRange {
  const [y, m] = parts(today);
  const monday = plus(today, -weekday(today));
  const week = (offset: number) => ({ from: plus(monday, offset), to: plus(monday, offset + 6) });
  const month = (offset: number) => ({
    from: dateOf(y, m + offset, 1),
    to: dateOf(y, m + offset + 1, 0),
  });
  switch (ref) {
    case 'today':
      return one(today);
    case 'tomorrow':
      return one(plus(today, 1));
    case 'yesterday':
      return one(plus(today, -1));
    case 'this_week':
      return week(0);
    case 'next_week':
      return week(7);
    case 'last_week':
      return week(-7);
    case 'this_month':
      return month(0);
    case 'next_month':
      return month(1);
    case 'last_month':
      return month(-1);
    default:
      return one(ref);
  }
}

/**
 * The calendar days a plan's `on` stands for: a period is its whole range, a
 * range runs from the start of its first to the end of its last. Null when it
 * would end before it starts.
 */
export function resolve(on: DateOn, today: Today): DateRange | null {
  const [first, last] = typeof on === 'string' ? [on, on] : [on.from, on.to];
  const from = rangeOf(first, today.date).from;
  const to = rangeOf(last, today.date).to;
  return from <= to ? { from, to } : null;
}

/* ---------------------------------------------------------------- words -- */

const say = (d: string, options: Intl.DateTimeFormatOptions): string => {
  const [y, m, day] = parts(d);
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', ...options }).format(
    Date.UTC(y, m - 1, day),
  );
};

/**
 * A range as people say it: "Tuesday 6 October", "12–18 October", "28
 * September–4 October". The year only when it is not this one.
 */
export function spoken(range: DateRange, today: Today): string {
  const year = range.from.slice(0, 4);
  const sameYear = year === range.to.slice(0, 4);
  const withYear = !sameYear || year !== today.date.slice(0, 4);
  const tail = withYear ? ` ${range.to.slice(0, 4)}` : '';
  const end = `${say(range.to, { day: 'numeric', month: 'long' })}${tail}`;
  // Put together by hand: en-GB puts a comma after the weekday once there is a year.
  if (range.from === range.to) return `${say(range.from, { weekday: 'long' })} ${end}`;
  if (range.from.slice(0, 7) === range.to.slice(0, 7)) {
    return `${say(range.from, { day: 'numeric' })}–${end}`;
  }
  const start = say(range.from, { day: 'numeric', month: 'long' });
  return `${start}${sameYear ? '' : ` ${year}`}–${end}`;
}
