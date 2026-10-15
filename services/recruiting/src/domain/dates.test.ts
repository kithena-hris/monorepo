import { CalendarDate } from '@kithena/contracts';
import { describe, expect, it } from 'vitest';

import { addBusinessDays, addMonths, monthsCovered } from './dates.js';

const d = (s: string) => CalendarDate.parse(s);

describe('calendar arithmetic', () => {
  it('clamps a month on to the last day of a shorter month', () => {
    expect(addMonths(d('2027-01-31'), 1)).toBe('2027-02-28');
    expect(addMonths(d('2028-01-31'), 1)).toBe('2028-02-29');
    expect(addMonths(d('2026-11-15'), 6)).toBe('2027-05-15');
  });

  it('counts a contract from the 1st to the last day of a month as whole months', () => {
    expect(monthsCovered(d('2027-01-01'), d('2027-06-30'))).toBe(6);
    expect(monthsCovered(d('2027-01-01'), d('2028-12-31'))).toBe(24);
    expect(monthsCovered(d('2027-01-15'), d('2027-07-13'))).toBe(5);
  });

  it('skips weekends and holidays when counting business days', () => {
    // Friday 6 November 2026, three business days later, with Monday a holiday.
    expect(addBusinessDays(d('2026-11-06'), 3, new Set(['2026-11-09']))).toBe('2026-11-12');
  });
});
