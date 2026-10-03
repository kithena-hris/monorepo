import { describe, expect, it } from 'vitest';
import { fixedClock, unwrap } from '@kithena/domain-kit';
import { CalendarDate } from '@kithena/contracts';

import { AttendanceClock } from './clock.js';
import { needsManager, openDays } from './correction.js';
import { DEFAULT_RULES, dayOf } from './day.js';
import { hm, weekdays, type Schedule } from './schedule.js';
import {
  MADRID,
  at,
  nextId,
  personId,
  punch,
  tenantId,
  thursdayNoon,
  wednesday,
  week,
} from './t20.fixture.js';

const madrid: Schedule = {
  kind: 'flexible',
  name: 'Madrid office',
  week: weekdays({ start: hm('09:00'), end: hm('17:30'), breakMinutes: 30 }),
  core: { start: hm('10:00'), end: hm('16:00') },
};
const actor = { kind: 'user', userId: '33333333-3333-7333-8333-333333333333' } as const;
const correlationId = '44444444-4444-7444-8444-444444444444';

const fixWednesday = (recordedAt: string) => {
  const clock = AttendanceClock.of({ tenantId, personId, timeZone: MADRID, punches: week });
  const out = unwrap(
    clock.correct({
      id: nextId(),
      supersedes: null,
      at: at('2026-09-30', '18:05'),
      kind: 'out',
      source: 'web',
      workModel: 'office',
      reason: 'Forgot after the release call',
      actor,
      correlationId,
      clock: fixedClock(recordedAt),
    }),
  );
  return { clock, out };
};

describe('a missed clock-out', () => {
  it('is not missed while the day is still going', () => {
    const shifts = AttendanceClock.of({
      tenantId,
      personId,
      timeZone: MADRID,
      punches: wednesday,
    }).shifts;
    expect(
      openDays({ shifts, schedule: madrid, now: at('2026-09-30', '20:00'), timeZone: MADRID }),
    ).toEqual([]);
  });

  it("is found on Thursday morning: Wednesday's", () => {
    const shifts = AttendanceClock.of({
      tenantId,
      personId,
      timeZone: MADRID,
      punches: week,
    }).shifts;
    const open = openDays({
      shifts,
      schedule: madrid,
      now: at('2026-10-01', '07:00'),
      timeZone: MADRID,
    });
    expect(open).toEqual([{ date: '2026-09-30', lastPunchAt: at('2026-09-30', '14:02') }]);
  });
});

describe("correcting Wednesday's clock-out to 18:05", () => {
  it('closes the day as a new punch and leaves the morning untouched', () => {
    const { clock, out } = fixWednesday('2026-10-01T12:33:00+02:00');
    expect(out).toMatchObject({
      kind: 'out',
      supersedes: null,
      reason: 'Forgot after the release call',
    });
    expect(clock.punches.slice(0, week.length)).toEqual(week);
    expect(
      openDays({ shifts: clock.shifts, schedule: madrid, now: thursdayNoon, timeZone: MADRID }),
    ).toEqual([]);
  });

  it('works 8h 28m, 28m of it overtime, once the 50-minute break is taken off', () => {
    // T21 says "9h 18m worked, 1h 18m overtime". That is 08:47 to 18:05 with
    // nothing taken off, but the same row records a 50-minute break (13:12 to
    // 14:02), and Monday and Tuesday's totals in the same table do subtract
    // theirs. The design's figure is the span, not the time worked.
    const { clock } = fixWednesday('2026-10-01T12:33:00+02:00');
    const day = dayOf({
      date: CalendarDate.parse('2026-09-30'),
      schedule: madrid,
      shifts: clock.shifts,
      now: thursdayNoon,
      timeZone: MADRID,
      rules: DEFAULT_RULES,
    });
    expect(day).toMatchObject({
      status: 'complete',
      workedMinutes: 8 * 60 + 28,
      breakMinutes: 50,
      overtimeMinutes: 28,
    });
    expect(hm('18:05') - hm('08:47')).toBe(9 * 60 + 18);
  });

  it('is not shown to the manager when made within 24 hours', () => {
    const { clock, out } = fixWednesday('2026-10-01T12:33:00+02:00');
    expect(needsManager(out, clock.punches)).toBe(false);
  });

  it('is shown to the manager beside the original when made later', () => {
    const { clock, out } = fixWednesday('2026-10-01T18:06:00+02:00');
    expect(needsManager(out, clock.punches)).toBe(true);
  });

  it('measures a replaced punch from the earlier of the two times', () => {
    // Moving Monday's 08:58 clock-in to 08:00 on Tuesday at 08:30 is within
    // 24 hours of 08:58 but not of the 08:00 it now claims.
    const original = punch('2026-09-28', '08:58', 'in');
    const clock = AttendanceClock.of({ tenantId, personId, timeZone: MADRID, punches: [original] });
    const moved = unwrap(
      clock.correct({
        id: nextId(),
        supersedes: original.id,
        at: at('2026-09-28', '08:00'),
        kind: 'in',
        source: 'web',
        workModel: 'office',
        reason: null,
        actor,
        correlationId,
        clock: fixedClock('2026-09-29T08:30:00+02:00'),
      }),
    );
    expect(needsManager(moved, clock.punches)).toBe(true);
  });
});
