import { describe, expect, it } from 'vitest';

import { aroundRequest, calendarWindow, clashOf } from './timeoff-calendar-views';

describe('aroundRequest', () => {
  it('reads four days before Adam’s 19–23 October to three after, and his week', () => {
    expect(aroundRequest({ from: '2026-10-19', to: '2026-10-23' })).toEqual({
      from: '2026-10-15',
      to: '2026-10-26',
    });
  });

  it('starts at the Monday when the request starts late in its week', () => {
    expect(aroundRequest({ from: '2026-10-09', to: '2026-10-09' })).toEqual({
      from: '2026-10-05',
      to: '2026-10-12',
    });
  });
});

describe('calendarWindow', () => {
  it('shows this month and this week, reading the week where it starts in September', () => {
    expect(calendarWindow({}, '2026-10-01')).toEqual({
      month: '2026-10',
      week: '2026-09-28',
      year: 2026,
      from: '2026-09-28',
      to: '2026-10-31',
    });
  });

  it('takes the month and week asked for, and the month a week runs into', () => {
    expect(calendarWindow({ month: '2026-11' }, '2026-10-01')).toMatchObject({
      month: '2026-11',
      week: '2026-11-02',
      from: '2026-11-01',
      to: '2026-11-30',
    });
    expect(calendarWindow({ week: '2026-10-28' }, '2026-10-01')).toMatchObject({
      month: '2026-10',
      week: '2026-10-26',
      to: '2026-10-31',
    });
    expect(calendarWindow({ week: '2026-11-30' }, '2026-10-01')).toMatchObject({
      month: '2026-12',
      from: '2026-11-30',
    });
  });

  it('ignores a month, week or year that is not one', () => {
    expect(
      calendarWindow({ month: '2026-13', week: 'soon', year: 'x' }, '2026-10-01'),
    ).toMatchObject({
      month: '2026-10',
      year: 2026,
    });
  });
});

describe('clashOf', () => {
  const view = {
    entries: [
      { requestId: 'omar', status: 'approved', span: { from: '2026-10-19', to: '2026-10-21' } },
      { requestId: 'adam', status: 'pending', span: { from: '2026-10-19', to: '2026-10-23' } },
      { requestId: 'leo', status: 'pending', span: { from: '2026-10-26', to: '2026-10-30' } },
    ],
    coverage: [
      { date: '2026-10-21', below: true },
      { date: '2026-10-26', below: false },
    ],
  };

  it('finds the waiting request on a day below the minimum, never an approved one', () => {
    expect(clashOf(view, undefined)).toBe('adam');
    expect(clashOf(view, 'leo')).toBe('adam');
    expect(clashOf({ ...view, coverage: [] }, undefined)).toBeNull();
  });
});
