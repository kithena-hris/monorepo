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

/**
 * The two derivations every `Clock` shares, so an implementation only has to
 * answer "what time is it" and the branding is not re-derived per clock.
 */
function brandedFrom(at: () => Date): Pick<Clock, 'today' | 'instant' | 'date'> {
  // 'en-CA' with a short date style is ISO 8601 (YYYY-MM-DD), which is the one
  // locale that gives the calendar date the contracts want without formatting
  // parts back together by hand.
  const civil = (timeZone: string): string =>
    new Intl.DateTimeFormat('en-CA', { timeZone, dateStyle: 'short' }).format(at());

  return {
    today: civil,
    instant: () => Instant.parse(at().toISOString()),
    date: (timeZone) => CalendarDate.parse(civil(timeZone)),
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
