import { describe, expect, it } from 'vitest';

import { workingFromCalendarDays } from './calendar-days.js';

describe('workingFromCalendarDays', () => {
  it('reads calendar days as the working days of a week, rounded up to the half day', () => {
    expect(workingFromCalendarDays('28.000')).toBe('20.000');
    expect(workingFromCalendarDays('30.000')).toBe('21.500');
    expect(workingFromCalendarDays('24.000', 6)).toBe('21.000');
    expect(workingFromCalendarDays('0.000')).toBe('0.000');
  });
});
