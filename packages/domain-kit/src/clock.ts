import { CalendarDate, Instant } from '@kithena/contracts';

/**
 * Never call `new Date()` inside domain code. Effective-dated HR logic is
 * impossible to test otherwise, and you will need to test "what did we think
 * was true on 3 March" more often than you expect.
 */
export interface Clock {
  now(): Date;
  today(timeZone: string): string;
  /**
   * The current instant, branded, ready to put on an event envelope.
   *
   * `now().toISOString()` produces a plain `string`, and every event envelope
   * wants an `Instant`. Without this the gap gets closed at each call site, and
   * the cheapest way to close it there is an assertion, which is how a domain
   * ends up asserting its way past the very brands that exist to stop a
   * `CalendarDate` being passed where an `Instant` belongs.
   *
   * Parsing rather than asserting: it is one regex per raised event, and it
   * makes the brand mean "this was checked" instead of "someone said so".
   */
  instant(): Instant;
  /** The current civil date in a time zone, branded. Same reasoning as `instant`. */
  date(timeZone: string): CalendarDate;
}

// 'en-CA' with a short date style is ISO 8601 (YYYY-MM-DD), which is the one
// locale that gives the calendar date the contracts want without formatting
// parts back together by hand.
const civil = (at: Date, timeZone: string): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone, dateStyle: 'short' }).format(at);

/**
 * The calendar day an instant falls on in a time zone. Pure.
 *
 * The one conversion from "when" to "which day". A date is not an instant: at
 * 11:30 UTC on 1 March it is already the 2nd in Auckland, so every rule that
 * compares a calendar date with "today" has to say whose today, and then ask
 * this. Throws a `RangeError` for a zone the runtime does not know, which is a
 * bug by the time it gets here: zones are validated where they are written.
 */
export function localDate(instant: string | Date, timeZone: string): CalendarDate {
  return CalendarDate.parse(civil(typeof instant === 'string' ? new Date(instant) : instant, timeZone));
}

/**
 * Whether the runtime knows this IANA zone.
 *
 * Asked of `Intl`, which throws for an unknown one, rather than of a copied
 * list: the IANA database changes, and a copy refuses a real zone the day it
 * falls behind. Offsets such as `UTC+2` are refused on purpose — an offset has
 * no daylight saving, so it is wrong for half of every year somewhere.
 */
export function isTimeZone(value: string): boolean {
  if (!/^[A-Za-z]+(?:\/[A-Za-z0-9_+-]+)*$/.test(value)) return false;
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: value }).resolvedOptions().timeZone !== '';
  } catch {
    return false;
  }
}

/**
 * The two derivations every `Clock` shares, so an implementation only has to
 * answer "what time is it" and the branding is not re-derived per clock.
 */
function brandedFrom(at: () => Date): Pick<Clock, 'today' | 'instant' | 'date'> {
  return {
    today: (timeZone) => civil(at(), timeZone),
    instant: () => Instant.parse(at().toISOString()),
    date: (timeZone) => localDate(at(), timeZone),
  };
}

export const systemClock: Clock = {
  now: () => new Date(),
  ...brandedFrom(() => new Date()),
};

export function fixedClock(iso: string): Clock {
  const at = new Date(iso);
  return {
    now: () => at,
    ...brandedFrom(() => at),
  };
}
