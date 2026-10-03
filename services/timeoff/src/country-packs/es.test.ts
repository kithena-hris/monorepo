import { describe, expect, it } from 'vitest';
import { CalendarDate, DateSpan, LeaveTypeDefinition } from '@kithena/contracts';

import { holidayDates, resolveHolidays } from '../domain/calendar/holiday-calendar.js';
import { MONDAY_TO_FRIDAY, daysAway, workingDays } from '../domain/calendar/working-days.js';
import { es } from './es.js';

const d = (s: string) => CalendarDate.parse(s);

/** T36's table for Madrid 2026, as drawn. */
const t36 = [
  '2026-01-01',
  '2026-01-06',
  '2026-04-02',
  '2026-04-03',
  '2026-05-01',
  '2026-05-15',
  '2026-08-15',
  '2026-10-12',
  '2026-11-09',
  '2026-12-08',
  '2026-12-25',
].map(d);

const layerOf = (day: string): string | undefined =>
  resolveHolidays(es.calendars.madrid, 2026).find((h) => h.date === day)?.layer;
const weeks = (row: {
  mandatoryWeeks: number;
  flexibleWeeks: number;
  laterWeeks: number;
}): number => row.mandatoryWeeks + row.flexibleWeeks + row.laterWeeks;

describe('the Spain country pack (PRD §12.3)', () => {
  it('is not reviewed, so settings can say so until legal signs it off', () => {
    expect(es.reviewed).toBe(false);
    expect(es.country).toBe('ES');
  });

  describe('holidays', () => {
    const madrid2026 = holidayDates(es.calendars.madrid, 2026);
    const barcelona2026 = holidayDates(es.calendars.barcelona, 2026);

    it('Madrid 2026 has every day in T36, San Isidro and La Almudena among them', () => {
      for (const day of t36) expect(madrid2026.has(day), day).toBe(true);
    });

    it('Madrid 2026 is the decree’s twelve and the city’s two: T36 leaves out 2 May, 2 Nov and 7 Dec', () => {
      expect(madrid2026.size).toBe(14);
      expect([...madrid2026].filter((day) => !t36.includes(day))).toEqual(
        ['2026-05-02', '2026-11-02', '2026-12-07'].map(d),
      );
    });

    it('Barcelona gets neither San Isidro nor La Almudena, nor Madrid’s Jueves Santo', () => {
      for (const day of ['2026-05-15', '2026-11-09', '2026-04-02'])
        expect(barcelona2026.has(d(day))).toBe(false);
      expect(barcelona2026.size).toBe(14);
      for (const day of [
        '2026-04-06',
        '2026-05-25',
        '2026-06-24',
        '2026-09-11',
        '2026-09-24',
        '2026-12-26',
      ]) {
        expect(barcelona2026.has(d(day)), day).toBe(true);
      }
    });

    it('2027 resolves to fourteen days in each city', () => {
      expect(holidayDates(es.calendars.madrid, 2027).size).toBe(14);
      expect(holidayDates(es.calendars.barcelona, 2027).size).toBe(14);
      expect(holidayDates(es.calendars.madrid, 2027).has(d('2027-08-16'))).toBe(true);
    });

    it('says which layer each day comes from, as T36’s "Applies to" does', () => {
      expect([layerOf('2026-10-12'), layerOf('2026-04-02'), layerOf('2026-05-15')]).toEqual([
        'es',
        'es-md',
        'madrid',
      ]);
    });

    it('with the real Madrid calendar, 26–30 Oct runs into the 2 Nov holiday: 10 days away', () => {
      const calendar = { pattern: MONDAY_TO_FRIDAY, holidays: madrid2026 };
      const span = DateSpan.parse({ from: '2026-10-26', to: '2026-10-30' });
      expect(workingDays(span, calendar)).toBe('5.000');
      expect(daysAway(span, calendar).days).toBe('10.000');
    });
  });

  describe('leave types', () => {
    it('every one is a valid, statutory leave type definition', () => {
      for (const type of es.leaveTypes) {
        expect(LeaveTypeDefinition.parse(type)).toEqual(type);
        expect(type.statutory).toBe(true);
      }
    });

    it('sick and parental show teammates "Off" and nothing else', () => {
      for (const type of es.leaveTypes.filter(
        (t) => t.category === 'sick_leave' || t.category === 'parental_leave',
      )) {
        expect(type.visibility, type.key).toBe('off_only');
      }
    });

    it('every statutory entitlement names a leave type the pack has', () => {
      const keys = new Set(es.leaveTypes.map((t) => t.key));
      for (const key of Object.keys(es.entitlements))
        expect(keys.has(key as never), key).toBe(true);
    });
  });

  it('attendance: 12 hours’ rest between days, records kept 4 years', () => {
    expect(es.attendance).toEqual({ minimumRestHours: 12, retentionYears: 4 });
  });

  it('parental: 19 weeks for each of two parents, 32 for a single parent', () => {
    expect(weeks(es.parental.twoParents)).toBe(19);
    expect(weeks(es.parental.singleParent)).toBe(32);
  });
});
