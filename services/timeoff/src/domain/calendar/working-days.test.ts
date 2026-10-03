import { describe, expect, it } from 'vitest';
import { CalendarDate, DateSpan } from '@kithena/contracts';

import {
  MONDAY_TO_FRIDAY,
  addDays,
  daysAway,
  workingDays,
  type WorkCalendar,
} from './working-days.js';

const d = (s: string) => CalendarDate.parse(s);
const span = (from: string, to: string, halves: Partial<DateSpan> = {}) =>
  DateSpan.parse({ from, to, ...halves });

/** T3, T4, MT6: Adam's calendar, with Fiesta Nacional on Monday 12 October 2026. */
const madrid: WorkCalendar = { pattern: MONDAY_TO_FRIDAY, holidays: new Set([d('2026-10-12')]) };

describe('workingDays and daysAway (T3, T4, MT6)', () => {
  it('13–16 Oct after the Monday holiday costs 4 and is 9 days away, Sat 10 to Sun 18', () => {
    const s = span('2026-10-13', '2026-10-16');
    expect(workingDays(s, madrid)).toBe('4.000');
    expect(daysAway(s, madrid)).toEqual({
      from: d('2026-10-10'),
      to: d('2026-10-18'),
      days: '9.000',
    });
  });

  it('19–23 Oct costs 5 and is 9 days away', () => {
    const s = span('2026-10-19', '2026-10-23');
    expect(workingDays(s, madrid)).toBe('5.000');
    expect(daysAway(s, madrid)).toEqual({
      from: d('2026-10-17'),
      to: d('2026-10-25'),
      days: '9.000',
    });
  });

  it('26–30 Oct costs 5 and is 9 days away', () => {
    const s = span('2026-10-26', '2026-10-30');
    expect(workingDays(s, madrid)).toBe('5.000');
    expect(daysAway(s, madrid).days).toBe('9.000');
  });

  it('a request that includes the holiday does not charge it', () => {
    expect(workingDays(span('2026-10-12', '2026-10-16'), madrid)).toBe('4.000');
  });

  it('half days at either end cost half and stop the absence reaching the weekend', () => {
    const s = span('2026-10-19', '2026-10-23', { startsHalfDay: true, endsHalfDay: true });
    expect(workingDays(s, madrid)).toBe('4.000');
    expect(daysAway(s, madrid)).toEqual({
      from: d('2026-10-19'),
      to: d('2026-10-23'),
      days: '4.000',
    });
  });

  it('a single half day is half a day', () => {
    const s = span('2026-10-21', '2026-10-21', { endsHalfDay: true });
    expect(workingDays(s, madrid)).toBe('0.500');
    expect(daysAway(s, madrid).days).toBe('0.500');
  });

  it('a half day falling on a non-working day changes nothing', () => {
    const s = span('2026-10-17', '2026-10-23', { startsHalfDay: true });
    expect(workingDays(s, madrid)).toBe('5.000');
    expect(daysAway(s, madrid).days).toBe('9.000');
  });

  it('follows the member’s pattern: Monday to Thursday makes Friday a day away, not a day used', () => {
    const fourDays: WorkCalendar = { pattern: new Set([1, 2, 3, 4]), holidays: new Set() };
    const s = span('2026-10-19', '2026-10-22');
    expect(workingDays(s, fourDays)).toBe('4.000');
    expect(daysAway(s, fourDays)).toEqual({
      from: d('2026-10-16'),
      to: d('2026-10-25'),
      days: '10.000',
    });
  });

  it('a request on a weekend costs nothing', () => {
    expect(workingDays(span('2026-10-17', '2026-10-18'), madrid)).toBe('0.000');
  });
});

describe('workingDays ≤ daysAway', () => {
  /*
   * Generated rather than fast-check, which the repository does not have: a
   * seeded generator walks every pattern shape, holiday density and half-day
   * combination worth meeting, and fails on the same case every run.
   */
  let seed = 20261012;
  const next = (n: number) => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return seed % n;
  };

  it('holds for 500 generated requests', () => {
    for (let i = 0; i < 500; i += 1) {
      const weekdays = new Set([1, 2, 3, 4, 5, 6, 7].filter(() => next(4) > 0));
      const start = addDays(d('2026-01-01'), next(365));
      const holidays = new Set(
        Array.from({ length: next(6) }, () => addDays(start, next(30) - 10)),
      );
      const calendar: WorkCalendar = { pattern: weekdays, holidays };
      const s = span(start, addDays(start, next(20)), {
        startsHalfDay: next(2) === 0,
        endsHalfDay: next(2) === 0,
      });

      const used = Number(workingDays(s, calendar));
      const away = daysAway(s, calendar);
      expect(
        used,
        JSON.stringify({ s, weekdays: [...weekdays], holidays: [...holidays] }),
      ).toBeLessThanOrEqual(Number(away.days));
      expect(away.from <= s.from && away.to >= s.to).toBe(true);
    }
  });
});
