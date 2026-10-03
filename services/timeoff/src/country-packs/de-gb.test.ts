import { describe, expect, it } from 'vitest';
import { CalendarDate, LeaveTypeDefinition } from '@kithena/contracts';

import { holidayDates, resolveHolidays } from '../domain/calendar/holiday-calendar.js';
import { de } from './de.js';
import { gb } from './gb.js';

const d = (s: string) => CalendarDate.parse(s);
const dates = (set: Set<CalendarDate>) => [...set].toSorted();

describe('the Germany and UK country packs (PRD §12.3, TOF-113)', () => {
  it('neither is reviewed, so neither is enabled before a lawyer signs it off', () => {
    expect([de.reviewed, gb.reviewed]).toEqual([false, false]);
    expect([de.country, gb.country]).toEqual(['DE', 'GB']);
  });

  describe('Germany', () => {
    it('Munich 2026: the nine federal days, Bavaria’s three and Munich’s Mariä Himmelfahrt', () => {
      expect(dates(holidayDates(de.calendars.munich, 2026))).toEqual(
        [
          '2026-01-01',
          '2026-01-06',
          '2026-04-03',
          '2026-04-06',
          '2026-05-01',
          '2026-05-14',
          '2026-05-25',
          '2026-06-04',
          '2026-08-15',
          '2026-10-03',
          '2026-11-01',
          '2026-12-25',
          '2026-12-26',
        ].map(d),
      );
    });

    it('Berlin 2027 adds Women’s Day and none of Bavaria’s; nothing moves off a weekend', () => {
      const berlin = holidayDates(de.calendars.berlin, 2027);
      expect(berlin.has(d('2027-03-08'))).toBe(true);
      expect(berlin.has(d('2027-01-06'))).toBe(false);
      expect(berlin.size).toBe(10);
      // 3 October 2026 is a Saturday and stays one.
      expect(holidayDates(de.calendars.berlin, 2026).has(d('2026-10-05'))).toBe(false);
    });

    it('20 working days of vacation on a five-day week; 11 hours’ rest', () => {
      expect(de.entitlements['vacation']).toEqual({ days: 20, counted: 'working', per: 'year' });
      expect(de.attendance.minimumRestHours).toBe(11);
    });
  });

  describe('United Kingdom', () => {
    it('England 2026: Boxing Day on a Saturday is observed on Monday 28 December', () => {
      const london = resolveHolidays(gb.calendars.london, 2026);
      expect(london.map((h) => h.date)).toEqual(
        [
          '2026-01-01',
          '2026-04-03',
          '2026-04-06',
          '2026-05-04',
          '2026-05-25',
          '2026-08-31',
          '2026-12-25',
          '2026-12-28',
        ].map(d),
      );
      expect(london.at(-1)?.movedFrom).toBe('2026-12-26');
    });

    it('England 2027: Christmas and Boxing Day both fall at the weekend, so 27 and 28 December', () => {
      const days = dates(holidayDates(gb.calendars.london, 2027));
      expect(days.slice(-2)).toEqual([d('2027-12-27'), d('2027-12-28')]);
      expect(days).toHaveLength(8);
    });

    it('Scotland keeps 2 January, St Andrew’s Day, August’s first Monday and the 2026 World Cup day, not Easter Monday', () => {
      const edinburgh = holidayDates(gb.calendars.edinburgh, 2026);
      for (const day of ['2026-01-02', '2026-06-15', '2026-08-03', '2026-11-30'])
        expect(edinburgh.has(d(day)), day).toBe(true);
      for (const day of ['2026-04-06', '2026-08-31'])
        expect(edinburgh.has(d(day)), day).toBe(false);
      // 2 January 2027 is a Saturday: Monday 4 January.
      expect(holidayDates(gb.calendars.edinburgh, 2027).has(d('2027-01-04'))).toBe(true);
    });

    it('5.6 weeks of leave is 28 days on a five-day week', () => {
      expect(gb.entitlements['vacation']).toEqual({ days: 28, counted: 'working', per: 'year' });
    });
  });

  for (const pack of [de, gb]) {
    describe(`${pack.country}: leave types`, () => {
      it('every one is a valid, statutory definition', () => {
        for (const type of pack.leaveTypes) {
          expect(LeaveTypeDefinition.parse(type)).toEqual(type);
          expect(type.statutory).toBe(true);
        }
      });

      it('sick and parental show teammates "Off" and nothing else', () => {
        for (const type of pack.leaveTypes.filter(
          (t) => t.category === 'sick_leave' || t.category === 'parental_leave',
        ))
          expect(type.visibility, type.key).toBe('off_only');
      });

      it('every entitlement names a leave type the pack has, and every calendar layer is listed', () => {
        const keys = new Set<string>(pack.leaveTypes.map((t) => t.key));
        for (const key of Object.keys(pack.entitlements)) expect(keys.has(key), key).toBe(true);
        const layers = new Set(pack.holidayLayers.map((l) => l.key));
        for (const l of Object.values(pack.calendars).flat())
          expect(layers.has(l.key), l.key).toBe(true);
      });
    });
  }
});
