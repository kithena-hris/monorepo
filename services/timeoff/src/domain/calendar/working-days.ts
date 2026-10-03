import { CalendarDate, DayAmount, type DateSpan } from '@kithena/contracts';

/**
 * What a request costs and how long the person is gone (PRD §7.3).
 *
 * Counted in half days, as integers, so a half day is exact without a decimal
 * library: 9 half days is `4.500` and nothing in between can drift.
 */

/** ISO weekdays a member works: 1 is Monday, 7 is Sunday. */
export type WorkPattern = ReadonlySet<number>;

export const MONDAY_TO_FRIDAY: WorkPattern = new Set([1, 2, 3, 4, 5]);

/** One member's working week and the public holidays of their location (§10.2). */
export interface WorkCalendar {
  readonly pattern: WorkPattern;
  readonly holidays: ReadonlySet<CalendarDate>;
}

const DAY_MS = 86_400_000;
const msOf = (day: string): number => Date.parse(`${day}T00:00:00Z`);

export const addDays = (day: CalendarDate, n: number): CalendarDate =>
  CalendarDate.parse(new Date(msOf(day) + n * DAY_MS).toISOString().slice(0, 10));

/** ISO weekday, 1 (Monday) to 7 (Sunday). */
export const weekday = (day: CalendarDate): number =>
  ((new Date(msOf(day)).getUTCDay() + 6) % 7) + 1;

export const isWorkingDay = (day: CalendarDate, calendar: WorkCalendar): boolean =>
  calendar.pattern.has(weekday(day)) && !calendar.holidays.has(day);

/** Every date from `from` to `to`, both included. */
export function datesIn(from: CalendarDate, to: CalendarDate): CalendarDate[] {
  const days: CalendarDate[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) days.push(day);
  return days;
}

/** Half days a boundary flag takes off, when it falls on a day that was going to be worked. */
function halvesOff(span: DateSpan, calendar: WorkCalendar): number {
  if (span.from === span.to) {
    return (span.startsHalfDay || span.endsHalfDay) && isWorkingDay(span.from, calendar) ? 1 : 0;
  }
  return (
    (span.startsHalfDay && isWorkingDay(span.from, calendar) ? 1 : 0) +
    (span.endsHalfDay && isWorkingDay(span.to, calendar) ? 1 : 0)
  );
}

const asDays = (halves: number): DayAmount =>
  DayAmount.parse(`${String(Math.floor(halves / 2))}.${halves % 2 === 1 ? '500' : '000'}`);

/** The cost: working days in the span, less holidays, with half days at the ends. */
export function workingDays(span: DateSpan, calendar: WorkCalendar): DayAmount {
  const worked = datesIn(span.from, span.to).filter((day) => isWorkingDay(day, calendar)).length;
  return asDays(worked * 2 - halvesOff(span, calendar));
}

/**
 * The continuous absence: the span stretched over the non-working days either
 * side of it (T4: 4 days used, 9 days away). A half day at an end means that
 * day was half worked, so the absence does not reach past it.
 */
export function daysAway(
  span: DateSpan,
  calendar: WorkCalendar,
): { readonly from: CalendarDate; readonly to: CalendarDate; readonly days: DayAmount } {
  // A single half day was half worked whichever half it was, so it reaches neither way.
  const single = span.from === span.to && (span.startsHalfDay || span.endsHalfDay);
  const halfAtStart = (single || span.startsHalfDay) && isWorkingDay(span.from, calendar);
  const halfAtEnd = (single || span.endsHalfDay) && isWorkingDay(span.to, calendar);
  let { from, to } = span;
  // ponytail: a pattern with no working day at all would never stop; a year either side is the ceiling.
  const limit = addDays(span.from, -366);
  if (!halfAtStart) {
    while (from > limit && !isWorkingDay(addDays(from, -1), calendar)) from = addDays(from, -1);
  }
  const end = addDays(span.to, 366);
  if (!halfAtEnd) {
    while (to < end && !isWorkingDay(addDays(to, 1), calendar)) to = addDays(to, 1);
  }
  const calendarDays = (msOf(to) - msOf(from)) / DAY_MS + 1;
  return { from, to, days: asDays(calendarDays * 2 - halvesOff(span, calendar)) };
}
