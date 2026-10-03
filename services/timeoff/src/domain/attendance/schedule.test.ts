import { describe, expect, it } from 'vitest';
import { CalendarDate } from '@kithena/contracts';

import { hm, plannedOn, plannedWeek, weekdays, type Schedule } from './schedule.js';

const d = (s: string) => CalendarDate.parse(s);

/** T33: "Mon–Fri · flexible, core 10:00–16:00 · 40h". */
const madrid: Schedule = {
  kind: 'flexible',
  name: 'Madrid office',
  week: weekdays({ start: hm('09:00'), end: hm('17:30'), breakMinutes: 30 }),
  core: { start: hm('10:00'), end: hm('16:00') },
};

/** T33: "Jul–Aug · 08:00–15:00 · 35h", over Madrid the rest of the year. */
const summer: Schedule = {
  kind: 'seasonal',
  name: 'Summer hours',
  base: madrid,
  seasons: [
    {
      from: '07-01',
      to: '08-31',
      schedule: {
        kind: 'fixed',
        name: 'Summer hours',
        week: weekdays({ start: hm('08:00'), end: hm('15:00'), breakMinutes: 0 }),
      },
    },
  ],
};

describe('schedules', () => {
  it('plans 40 hours a week at the Madrid office', () => {
    expect(plannedWeek(madrid, d('2026-09-28'))).toBe(40 * 60);
  });

  it('plans 8 hours on a weekday and nothing at the weekend', () => {
    expect(plannedOn(madrid, d('2026-10-02'))).toEqual({
      date: '2026-10-02',
      plannedMinutes: 480,
      window: { start: 540, end: 1050, breakMinutes: 30 },
      core: { start: 600, end: 960 },
    });
    expect(plannedOn(madrid, d('2026-10-03')).plannedMinutes).toBe(0);
  });

  it('plans 35 hours in July and August and 40 the rest of the year', () => {
    expect(plannedWeek(summer, d('2026-08-03'))).toBe(35 * 60);
    expect(plannedWeek(summer, d('2026-09-28'))).toBe(40 * 60);
    // The week of 31 August: Monday is still summer.
    expect(plannedWeek(summer, d('2026-08-31'))).toBe(7 * 60 + 4 * 8 * 60);
  });

  it('wraps a season over the new year', () => {
    const winter: Schedule = {
      kind: 'seasonal',
      name: 'Winter',
      base: madrid,
      seasons: [{ from: '12-15', to: '01-15', schedule: { kind: 'fixed', name: 'Off', week: {} } }],
    };
    expect(plannedOn(winter, d('2026-12-28')).plannedMinutes).toBe(0);
    expect(plannedOn(winter, d('2027-01-14')).plannedMinutes).toBe(0);
    expect(plannedOn(winter, d('2027-01-18')).plannedMinutes).toBe(480);
  });

  it('rotates shifts from an anchor day, nights included', () => {
    const early = { start: hm('06:00'), end: hm('14:00'), breakMinutes: 30 };
    const night = { start: hm('22:00'), end: hm('06:00') + 24 * 60, breakMinutes: 30 };
    const rota: Schedule = {
      kind: 'rotating',
      name: 'Warehouse shifts',
      anchor: d('2026-09-28'),
      cycle: [early, early, null, night, night, null],
    };
    expect(plannedOn(rota, d('2026-09-28')).window).toEqual(early);
    expect(plannedOn(rota, d('2026-09-30')).plannedMinutes).toBe(0);
    expect(plannedOn(rota, d('2026-10-01')).plannedMinutes).toBe(450);
    // Before the anchor counts backwards round the same cycle.
    expect(plannedOn(rota, d('2026-09-27')).plannedMinutes).toBe(0);
    expect(plannedOn(rota, d('2026-10-04')).window).toEqual(early);
  });
});
