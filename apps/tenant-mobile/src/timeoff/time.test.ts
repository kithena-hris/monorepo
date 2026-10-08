import { describe, expect, it } from 'vitest';

import { duration, localDate, minuteOfDay, stopwatch } from './time';

describe('the clock', () => {
  it('reads the wall clock in a zone', () => {
    expect(localDate('2026-09-30T22:30:00Z', 'Europe/Madrid')).toBe('2026-10-01');
    expect(minuteOfDay('2026-09-30T16:05:00Z', 'Europe/Madrid')).toBe(18 * 60 + 5);
    expect(minuteOfDay('2026-09-30T00:10:00Z', 'UTC')).toBe(10);
  });
  it('says a length the way the day bar does', () => {
    expect(duration(485)).toBe('8h 05m');
    expect(duration(45)).toBe('45m');
    expect(stopwatch(13268)).toBe('3:41:08');
  });
});
