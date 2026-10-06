import { describe, expect, it } from 'vitest';

import { addMonths, daysBetween, formatDate, monthGrid, parseDate } from './dates.ts';

describe('parseDate', () => {
  it('reads ISO, numbers in the locale order, and month names', () => {
    expect(parseDate('2026-10-14')).toBe('2026-10-14');
    expect(parseDate('14/10/2026', 'en-GB')).toBe('2026-10-14');
    expect(parseDate('10/14/2026', 'en-US')).toBe('2026-10-14');
    expect(parseDate('14.10.26', 'de-DE')).toBe('2026-10-14');
    expect(parseDate('14 Oct 2026', 'en-GB')).toBe('2026-10-14');
    expect(parseDate('October 14, 2026', 'en-US')).toBe('2026-10-14');
    expect(parseDate('14. Oktober 2026', 'de-DE')).toBe('2026-10-14');
  });

  it('refuses a day that does not exist rather than moving it', () => {
    expect(parseDate('31/02/2026', 'en-GB')).toBeNull();
    expect(parseDate('2026-13-01')).toBeNull();
    expect(parseDate('next tuesday')).toBeNull();
    expect(parseDate('')).toBeNull();
  });
});

describe('the grid', () => {
  it('lays October 2026 out from Monday and from Sunday', () => {
    const monday = monthGrid('2026-10-14', 1);
    expect(monday).toHaveLength(5);
    expect(monday[0]).toEqual([
      null,
      null,
      null,
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
      '2026-10-04',
    ]);
    const sunday = monthGrid('2026-10-14', 0);
    expect(sunday[0]?.[4]).toBe('2026-10-01');
  });

  it('clamps a month on and counts both ends', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(daysBetween('2026-10-14', '2026-10-18')).toBe(5);
  });

  it('formats in the zone-free UTC day', () => {
    expect(formatDate('2026-10-14', 'en-GB')).toBe('14 Oct 2026');
  });
});
