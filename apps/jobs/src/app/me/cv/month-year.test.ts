import { describe, expect, it } from 'vitest';

import { toMonthYear } from './month-year';

describe('a CV date the AI wrote, as a picked value', () => {
  it('keeps a year, or a year and month, as they are', () => {
    expect(toMonthYear('2021')).toBe('2021');
    expect(toMonthYear('2023-03')).toBe('2023-03');
  });
  it('reads a month written out beside the year', () => {
    expect(toMonthYear('Mar 2023')).toBe('2023-03');
    expect(toMonthYear('September 2019')).toBe('2019-09');
  });
  it('reads a role still held as now, and nothing as nothing', () => {
    expect(toMonthYear('now')).toBe('now');
    expect(toMonthYear('present')).toBe('now');
    expect(toMonthYear('')).toBe('');
    expect(toMonthYear('2 years')).toBe('');
  });
});
