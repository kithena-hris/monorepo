import { describe, expect, it } from 'vitest';

import { fixedClock, isTimeZone, localDate } from './clock.js';

/**
 * The one conversion from an instant to a calendar day. Every "today" in the
 * product is this function applied to the clock's instant, so the zones at the
 * edges of the map and the DST nights are where it is tested.
 */
describe('localDate', () => {
  // 11:30 UTC on 1 March: already the 2nd in Auckland (UTC+13 in summer),
  // still the 1st in Los Angeles, Kolkata and Madrid.
  const at = '2026-03-01T11:30:00.000Z';

  it.each([
    ['Pacific/Auckland', '2026-03-02'],
    ['America/Los_Angeles', '2026-03-01'],
    ['Asia/Kolkata', '2026-03-01'],
    ['Europe/Madrid', '2026-03-01'],
    ['Etc/UTC', '2026-03-01'],
  ])('%s is on %s', (zone, day) => {
    expect(localDate(at, zone)).toBe(day);
  });

  it('turns Kolkata over at 18:30 UTC, half an hour off a whole-hour zone', () => {
    expect(localDate('2026-03-01T18:29:59.999Z', 'Asia/Kolkata')).toBe('2026-03-01');
    expect(localDate('2026-03-01T18:30:00.000Z', 'Asia/Kolkata')).toBe('2026-03-02');
  });

  it('keeps Los Angeles on the previous day through the UTC morning (UTC-7 in summer)', () => {
    expect(localDate('2026-07-01T06:59:59.000Z', 'America/Los_Angeles')).toBe('2026-06-30');
    expect(localDate('2026-07-01T07:00:00.000Z', 'America/Los_Angeles')).toBe('2026-07-01');
  });

  it('follows Madrid across the spring-forward night (29 March 2026)', () => {
    expect(localDate('2026-03-28T22:59:59.000Z', 'Europe/Madrid')).toBe('2026-03-28');
    expect(localDate('2026-03-28T23:00:00.000Z', 'Europe/Madrid')).toBe('2026-03-29');
    // Midnight on the 30th is 22:00 UTC once Madrid is UTC+2.
    expect(localDate('2026-03-29T21:59:59.000Z', 'Europe/Madrid')).toBe('2026-03-29');
    expect(localDate('2026-03-29T22:00:00.000Z', 'Europe/Madrid')).toBe('2026-03-30');
  });

  it('follows Auckland across its autumn fall-back (5 April 2026)', () => {
    expect(localDate('2026-04-04T10:59:59.000Z', 'Pacific/Auckland')).toBe('2026-04-04');
    expect(localDate('2026-04-04T11:00:00.000Z', 'Pacific/Auckland')).toBe('2026-04-05');
    // Midnight on the 6th is 12:00 UTC once the clocks have gone back to +12.
    expect(localDate('2026-04-05T11:59:59.000Z', 'Pacific/Auckland')).toBe('2026-04-05');
    expect(localDate('2026-04-05T12:00:00.000Z', 'Pacific/Auckland')).toBe('2026-04-06');
  });

  it('is what a clock answers for its own instant', () => {
    const clock = fixedClock(at);
    expect(clock.date('Pacific/Auckland')).toBe(localDate(clock.instant(), 'Pacific/Auckland'));
  });
});

describe('isTimeZone', () => {
  it.each(['Europe/Madrid', 'Asia/Kolkata', 'Asia/Calcutta', 'Etc/UTC'])('accepts %s', (zone) => {
    expect(isTimeZone(zone)).toBe(true);
  });

  it.each(['', 'Europe/Atlantis', 'UTC+2', 'Mars/Olympus_Mons'])('refuses %j', (zone) => {
    expect(isTimeZone(zone)).toBe(false);
  });
});
