import { describe, expect, it } from 'vitest';
import type { CalendarDate } from '@kithena/contracts';

import { resolveHolidays } from '../domain/calendar/holiday-calendar.js';
import { addDays, weekday } from '../domain/calendar/working-days.js';
import { CALENDARS, calendarsFor, instantIn, planDay, planLeave } from './year.js';

const d = (s: string) => s as CalendarDate;
const usHolidays = new Set(
  resolveHolidays(
    CALENDARS.filter((l) => l.key === 'us'),
    2026,
  ).map((h) => h.date),
);

describe('a seeded year', () => {
  it('gives each office its calendars, every one of them known', () => {
    const known = new Set(CALENDARS.map((l) => l.key));
    for (const [country, place] of [
      ['US', 'Chicago HQ'],
      ['CA', 'Toronto Office'],
      ['GB', 'London Office'],
      ['DE', 'Hamburg Port Office'],
      ['ES', 'Madrid Office'],
      ['IN', 'Bengaluru Tech Center'],
    ] as const) {
      const chosen = calendarsFor(country, place);
      expect(chosen.length).toBeGreaterThan(0);
      for (const k of chosen) expect(known.has(k)).toBe(true);
    }
    expect(calendarsFor('DE', 'Hamburg Port Office')).toEqual(['de', 'de_hh']);
    expect(usHolidays.has(d('2026-07-03'))).toBe(true);
  });

  it('plans time off that never overlaps, avoids holidays and weekends, and is the same each run', () => {
    const input = {
      personId: '01a1b4f9-0180-7000-b489-c9691bf07c9c',
      allowance: 15,
      start: d('2026-02-10'),
      today: d('2026-11-07'),
      yearEnd: d('2026-12-31'),
      holidays: usHolidays,
    };
    const plan = planLeave(input);
    expect(planLeave(input)).toEqual(plan);
    expect(plan.length).toBeGreaterThan(1);
    const seen = new Set<string>();
    for (const leave of plan) {
      expect(leave.from >= input.start).toBe(true);
      expect(weekday(leave.from)).toBeLessThanOrEqual(5);
      expect(usHolidays.has(leave.from)).toBe(false);
      for (let day = leave.from; day <= leave.to; day = addDays(day, 1)) {
        expect(seen.has(day)).toBe(false);
        seen.add(day);
      }
    }
    // Some taken already, one still to come.
    expect(plan.some((l) => l.to < input.today)).toBe(true);
    expect(plan.some((l) => l.from > input.today)).toBe(true);
  });

  it('clocks a day in, out to lunch and back, and out again', () => {
    const day = planDay('someone', d('2026-03-04'), false);
    expect(day.map((p) => p.kind)).toEqual(['in', 'break_start', 'break_end', 'out']);
    const minutes = day.map((p) => p.minute);
    expect(minutes).toEqual(minutes.toSorted((a, b) => a - b));
  });

  it('turns a local time into the instant, across summer time', () => {
    expect(instantIn(d('2026-01-15'), 9 * 60, 'America/Chicago')).toBe('2026-01-15T15:00:00.000Z');
    expect(instantIn(d('2026-07-15'), 9 * 60, 'America/Chicago')).toBe('2026-07-15T14:00:00.000Z');
    expect(instantIn(d('2026-07-15'), 9 * 60, 'Europe/London')).toBe('2026-07-15T08:00:00.000Z');
    expect(instantIn(d('2026-07-15'), 9 * 60 + 30, 'Asia/Kolkata')).toBe(
      '2026-07-15T04:00:00.000Z',
    );
  });
});
