import { describe, expect, it } from 'vitest';

import { addMonths, byMonth, completeByMonth } from './queries.js';

describe('months without a clock', () => {
  it('crosses a year boundary in both directions', () => {
    expect(addMonths('2026-03', -11)).toBe('2025-04');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2025-12', 1)).toBe('2026-01');
    expect(addMonths('2026-03', 0)).toBe('2026-03');
  });
});

describe('folding snapshot days into months', () => {
  it('takes headcount from the last day and sums the flows of every day', () => {
    expect(
      byMonth([
        { day: '2026-02-28', headcount: 10, joiners: 1, leavers: 0 },
        { day: '2026-03-01', headcount: 11, joiners: 1, leavers: 0 },
        { day: '2026-03-31', headcount: 9, joiners: 0, leavers: 2 },
      ]),
    ).toEqual([
      { month: '2026-02', headcount: 10, joiners: 1, leavers: 0 },
      { month: '2026-03', headcount: 9, joiners: 1, leavers: 2 },
    ]);
  });

  it('leaves a month nobody snapshotted absent rather than zero', () => {
    const months = byMonth([
      { day: '2026-01-31', headcount: 10, joiners: 0, leavers: 0 },
      { day: '2026-03-31', headcount: 10, joiners: 0, leavers: 0 },
    ]);
    expect(months.map((m) => m.month)).toEqual(['2026-01', '2026-03']);
  });
});

describe('complete records by month', () => {
  it('reads each month off its last snapshot day, as a whole percent', () => {
    expect(
      completeByMonth([
        { day: '2026-07-15', complete: 50, incomplete: 50 },
        { day: '2026-07-31', complete: 62, incomplete: 38 },
        { day: '2026-08-31', complete: 2, incomplete: 1 },
      ]),
    ).toEqual([
      { month: '2026-07', percent: 62 },
      { month: '2026-08', percent: 67 },
    ]);
  });

  it('leaves out a month with nobody to be complete, rather than calling it 0%', () => {
    expect(
      completeByMonth([
        { day: '2026-06-30', complete: 0, incomplete: 0 },
        { day: '2026-07-31', complete: 1, incomplete: 0 },
      ]),
    ).toEqual([{ month: '2026-07', percent: 100 }]);
  });
});
