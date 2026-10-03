import { describe, expect, it } from 'vitest';
import { unwrap } from '@kithena/domain-kit';
import { CalendarDate, type Instant } from '@kithena/contracts';

import { shiftsOf, type Punch } from './clock.js';
import { DEFAULT_RULES, dayOf, overtimeBecomes, restBreaches, weekOf } from './day.js';
import { hm, weekdays, type Schedule } from './schedule.js';
import { MADRID, at, punch, thursdayNoon, week } from './t20.fixture.js';

const madrid: Schedule = {
  kind: 'flexible',
  name: 'Madrid office',
  week: weekdays({ start: hm('09:00'), end: hm('17:30'), breakMinutes: 30 }),
  core: { start: hm('10:00'), end: hm('16:00') },
};

const dayFor = (date: string, punches: readonly Punch[] = week, now: Instant = thursdayNoon) =>
  dayOf({
    date: CalendarDate.parse(date),
    schedule: madrid,
    shifts: unwrap(shiftsOf(punches, MADRID)),
    now,
    timeZone: MADRID,
    rules: DEFAULT_RULES,
  });

describe("T20's week", () => {
  it('Monday: 08:58 to 17:41 with a 45-minute break is 7h 58m', () => {
    const monday = dayFor('2026-09-28');
    expect(monday).toMatchObject({
      status: 'complete',
      workedMinutes: 7 * 60 + 58,
      breakMinutes: 45,
      plannedMinutes: 480,
      overtimeMinutes: 0,
      flags: [],
    });
    expect(monday.segments).toEqual([
      { kind: 'worked', from: hm('08:58'), to: hm('13:05') },
      { kind: 'break', from: hm('13:05'), to: hm('13:50') },
      { kind: 'worked', from: hm('13:50'), to: hm('17:41') },
    ]);
  });

  it('Tuesday: 09:02 to 18:47 with 40 minutes is 9h 05m, 1h 05m of it overtime', () => {
    const tuesday = dayFor('2026-09-29');
    expect(tuesday).toMatchObject({
      status: 'complete',
      workedMinutes: 9 * 60 + 5,
      breakMinutes: 40,
      overtimeMinutes: 65,
    });
    // Overtime is the last 65 minutes worked, wherever the eighth hour ended.
    expect(tuesday.segments.slice(-2)).toEqual([
      { kind: 'worked', from: hm('14:10'), to: hm('17:42') },
      { kind: 'overtime', from: hm('17:42'), to: hm('18:47') },
    ]);
  });

  it('Wednesday: no clock-out reads as missing, with no total', () => {
    const wednesday = dayFor('2026-09-30');
    expect(wednesday).toMatchObject({ status: 'open', workedMinutes: null, overtimeMinutes: 0 });
    expect(wednesday.segments.at(-1)).toEqual({
      kind: 'missing',
      from: hm('14:02'),
      // What was left of the planned 8 hours after the morning's 4h 25m.
      to: hm('17:37'),
    });
  });

  it('Thursday at 12:33: 3h 41m live since 08:52', () => {
    expect(dayFor('2026-10-01')).toMatchObject({
      status: 'live',
      workedMinutes: 3 * 60 + 41,
      segments: [{ kind: 'live', from: hm('08:52'), to: hm('12:33') }],
    });
  });

  it('Friday: planned, 8 hours from 09:00 to 17:30', () => {
    expect(dayFor('2026-10-02')).toMatchObject({
      status: 'planned',
      workedMinutes: null,
      plannedMinutes: 480,
      segments: [{ kind: 'planned', from: hm('09:00'), to: hm('17:30') }],
    });
  });

  it('totals the week against the schedule', () => {
    const days = ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02'].map((d) =>
      dayFor(d),
    );
    expect(weekOf(days, DEFAULT_RULES)).toEqual({
      workedMinutes: 478 + 545 + 221,
      plannedMinutes: 2400,
      overtimeMinutes: 65,
      flags: [],
    });
  });
});

describe('the rules', () => {
  it('flags more than 6 hours with no 30-minute break', () => {
    const day = [
      punch('2026-09-28', '09:00', 'in'),
      punch('2026-09-28', '13:00', 'break_start'),
      punch('2026-09-28', '13:20', 'break_end'),
      punch('2026-09-28', '17:00', 'out'),
    ];
    expect(dayFor('2026-09-28', day).flags).toContain('break_missing');
  });

  it('flags a flexible day that missed the core hours', () => {
    const day = [punch('2026-09-28', '10:30', 'in'), punch('2026-09-28', '15:30', 'out')];
    expect(dayFor('2026-09-28', day).flags).toEqual(['core_hours_missed']);
  });

  it('finds less than 12 hours between one day and the next', () => {
    const late = [
      punch('2026-09-28', '12:00', 'in'),
      punch('2026-09-28', '22:00', 'out'),
      punch('2026-09-29', '08:00', 'in'),
      punch('2026-09-29', '16:00', 'out'),
    ];
    expect(restBreaches(unwrap(shiftsOf(late, MADRID)), DEFAULT_RULES)).toEqual([
      { date: '2026-09-29', restMinutes: 600 },
    ]);
    expect(restBreaches(unwrap(shiftsOf(week, MADRID)), DEFAULT_RULES)).toEqual([]);
  });

  it('flags a week over 40h plus 2h of overtime', () => {
    const long = ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02'].flatMap(
      (d) => [punch(d, '08:00', 'in'), punch(d, '17:01', 'out')],
    );
    const days = ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02'].map((d) =>
      dayFor(d, long, at('2026-10-03', '10:00')),
    );
    expect(weekOf(days, DEFAULT_RULES)).toMatchObject({
      workedMinutes: 5 * 541,
      flags: ['weekly_max_exceeded'],
    });
  });

  it('counts a night shift on the day it started', () => {
    const night = [punch('2026-09-28', '22:00', 'in'), punch('2026-09-29', '06:00', 'out')];
    expect(dayFor('2026-09-28', night, at('2026-09-29', '07:00'))).toMatchObject({
      workedMinutes: 480,
      segments: [{ kind: 'worked', from: hm('22:00'), to: hm('06:00') + 1440 }],
    });
  });
});

describe('what overtime becomes', () => {
  it('banks comp time hour for hour', () => {
    expect(overtimeBecomes(65, { becomes: 'comp', multiplier: '1.25' }, null)).toEqual({
      ok: true,
      value: { use: 'comp', minutes: 65, multiplier: null },
    });
  });

  it('pays at the multiplier', () => {
    expect(unwrap(overtimeBecomes(65, { becomes: 'paid', multiplier: '1.25' }, null))).toEqual({
      use: 'paid',
      minutes: 65,
      multiplier: '1.25',
    });
  });

  it('asks the person when they choose, and takes the choice', () => {
    const choose = { becomes: 'choose', multiplier: '1.25' } as const;
    expect(overtimeBecomes(65, choose, null)).toMatchObject({
      ok: false,
      error: { code: 'CHOICE_REQUIRED' },
    });
    expect(unwrap(overtimeBecomes(65, choose, 'comp')).use).toBe('comp');
  });

  it('refuses a choice the policy does not offer', () => {
    expect(overtimeBecomes(65, { becomes: 'comp', multiplier: '1.25' }, 'paid')).toMatchObject({
      ok: false,
      error: { code: 'CHOICE_NOT_OFFERED' },
    });
  });
});
