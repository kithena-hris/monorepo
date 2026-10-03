import { describe, expect, it } from 'vitest';
import { unwrap } from '@kithena/domain-kit';
import { CalendarDate } from '@kithena/contracts';

import { shiftsOf } from './clock.js';
import { DEFAULT_RULES, dayOf } from './day.js';
import { dailyRecord, exceptionsOf } from './exceptions.js';
import { hm, weekdays, type Schedule } from './schedule.js';
import { MADRID, thursdayNoon, week } from './t20.fixture.js';

const schedule: Schedule = {
  kind: 'fixed',
  name: 'Standard',
  week: weekdays({ start: hm('09:00'), end: hm('17:30'), breakMinutes: 30 }),
};
const shifts = unwrap(shiftsOf(week, MADRID));
const days = ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01'].map((date) =>
  dayOf({
    date: CalendarDate.parse(date),
    schedule,
    shifts,
    now: thursdayNoon,
    timeZone: MADRID,
    rules: DEFAULT_RULES,
  }),
);
const d = (s: string) => CalendarDate.parse(s);

describe('exceptionsOf (PRD §11.7)', () => {
  it('finds a missed clock-out, short rest, overtime nobody decided and a holiday worked', () => {
    expect(
      exceptionsOf({
        days,
        restBreaches: [{ date: d('2026-09-29'), restMinutes: 11 * 60 }],
        holidays: [{ date: d('2026-09-28'), name: 'Local holiday' }],
        decided: [],
      }),
    ).toEqual([
      { kind: 'worked_on_holiday', date: '2026-09-28', minutes: 478, holiday: 'Local holiday' },
      { kind: 'short_rest', date: '2026-09-29', minutes: 660, holiday: null },
      { kind: 'overtime_waiting', date: '2026-09-29', minutes: 65, holiday: null },
      { kind: 'missed_clock_out', date: '2026-09-30', minutes: null, holiday: null },
    ]);
  });

  it('leaves out overtime a manager already decided, and a day still running', () => {
    const found = exceptionsOf({
      days,
      restBreaches: [],
      holidays: [],
      decided: [d('2026-09-29')],
    });
    expect(found.map((e) => e.kind)).toEqual(['missed_clock_out']);
  });
});

describe('dailyRecord: the inspector’s daily record', () => {
  it('gives each day’s start, end and breaks in the member’s zone, and nothing else', () => {
    const rows = dailyRecord(shifts, MADRID);
    expect(rows[0]).toEqual({
      date: '2026-09-28',
      start: '08:58',
      end: '17:41',
      breaks: [{ start: '13:05', end: '13:50' }],
      breakMinutes: 45,
      workedMinutes: 478,
    });
    // Wednesday was never clocked out: its end and what it came to are not known.
    expect(rows[2]).toMatchObject({ date: '2026-09-30', end: null, workedMinutes: null });
    expect(rows).toHaveLength(4);
  });
});
