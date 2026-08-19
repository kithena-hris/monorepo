import { describe, expect, it } from 'vitest';

import { addDays, addMonths, formatIsoDate, parseIsoDate } from './calendar';
import { paginationRange } from '../pagination/pagination';

/**
 * The only two pieces of non-presentational logic in the package. Both are
 * pure, so the tests are cheap, and both are the kind of arithmetic that is
 * wrong by exactly one day or one page and passes review anyway.
 */

describe('calendar date arithmetic', () => {
  it('round-trips an ISO date through UTC', () => {
    expect(formatIsoDate(parseIsoDate('2026-08-09'))).toBe('2026-08-09');
  });

  it('rejects anything that is not a calendar date', () => {
    expect(() => parseIsoDate('not-a-date')).toThrow(TypeError);
  });

  it('crosses a month boundary', () => {
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01');
  });

  it('crosses a year boundary backwards', () => {
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('handles a leap day', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2027-02-28', 1)).toBe('2027-03-01');
  });

  /*
   * The reason every date in this package is a string. If these were `Date`
   * objects they would carry the runner's zone, and this test would pass in
   * Madrid and fail in São Paulo, or, worse, pass in both and ship a leave
   * day that is a day out for half the tenants.
   */
  it('does not shift with the local time zone', () => {
    const original = process.env['TZ'];
    try {
      process.env['TZ'] = 'Pacific/Kiritimati';
      expect(addDays('2026-08-09', 1)).toBe('2026-08-10');
      process.env['TZ'] = 'Pacific/Niue';
      expect(addDays('2026-08-09', 1)).toBe('2026-08-10');
    } finally {
      process.env['TZ'] = original;
    }
  });

  it('clamps the day when a month is shorter', () => {
    // 31 January plus one month is 28 February, not 3 March.
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
  });

  it('pages backwards across a year', () => {
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-15');
  });
});

describe('paginationRange', () => {
  it('renders every page when there is nothing worth eliding', () => {
    expect(paginationRange(1, 5, 1)).toEqual([1, 2, 3, 4, 5]);
  });

  it('elides only on the right near the start', () => {
    expect(paginationRange(2, 46, 1)).toEqual([1, 2, 3, 4, 5, 'ellipsis', 46]);
  });

  it('elides only on the left near the end', () => {
    expect(paginationRange(45, 46, 1)).toEqual([1, 'ellipsis', 42, 43, 44, 45, 46]);
  });

  it('elides both sides in the middle', () => {
    expect(paginationRange(23, 46, 1)).toEqual([1, 'ellipsis', 22, 23, 24, 'ellipsis', 46]);
  });

  it('widens the window with more siblings', () => {
    expect(paginationRange(23, 46, 2)).toEqual([1, 'ellipsis', 21, 22, 23, 24, 25, 'ellipsis', 46]);
  });

  it('always includes the current page', () => {
    for (let page = 1; page <= 46; page += 1) {
      expect(paginationRange(page, 46, 1)).toContain(page);
    }
  });
});
