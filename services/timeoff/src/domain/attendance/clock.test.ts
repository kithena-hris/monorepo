import { describe, expect, it } from 'vitest';
import { fixedClock, unwrap } from '@kithena/domain-kit';
import { AttendanceCorrected, AttendancePunched, PunchInput } from '@kithena/contracts';

import { AttendanceClock, shiftsOf, standing, stateOf } from './clock.js';
import { MADRID, at, nextId, personId, punch, tenantId, week } from './t20.fixture.js';

const actor = { kind: 'user', userId: '33333333-3333-7333-8333-333333333333' } as const;
const correlationId = '44444444-4444-7444-8444-444444444444';

const clockOf = (punches = week) =>
  AttendanceClock.of({ tenantId, personId, timeZone: MADRID, punches });

const input = (kind: PunchInput['kind'], source: PunchInput['source'] = 'web') =>
  PunchInput.parse({ kind, source, workModel: 'office' });

describe('the state of the clock', () => {
  it('is out before the first punch', () => {
    expect(stateOf(unwrap(shiftsOf([], MADRID)))).toBe('out');
  });

  it('follows in, break and out', () => {
    const day = [punch('2026-09-28', '09:00', 'in'), punch('2026-09-28', '13:00', 'break_start')];
    expect(stateOf(unwrap(shiftsOf(day.slice(0, 1), MADRID)))).toBe('in');
    expect(stateOf(unwrap(shiftsOf(day, MADRID)))).toBe('on_break');
    const back = [...day, punch('2026-09-28', '13:30', 'break_end')];
    expect(stateOf(unwrap(shiftsOf(back, MADRID)))).toBe('in');
    const done = [...back, punch('2026-09-28', '17:30', 'out')];
    expect(stateOf(unwrap(shiftsOf(done, MADRID)))).toBe('out');
  });

  it('reads Thursday as clocked in', () => {
    expect(clockOf().state).toBe('in');
  });
});

describe('impossible transitions', () => {
  const cases = [
    ['out', [], 'NOT_CLOCKED_IN'],
    ['break_start', [], 'NOT_CLOCKED_IN'],
    ['break_end', [], 'NOT_ON_BREAK'],
    ['in', ['in'], 'ALREADY_CLOCKED_IN'],
    ['break_end', ['in'], 'NOT_ON_BREAK'],
    ['break_start', ['in', 'break_start'], 'ALREADY_ON_BREAK'],
    ['in', ['in', 'break_start'], 'ALREADY_CLOCKED_IN'],
  ] as const;

  it.each(cases)('refuses %s after %j', (kind, before, code) => {
    const punches = before.map((k, i) => punch('2026-09-28', `0${String(8 + i)}:00`, k));
    const result = clockOf(punches).punch({
      id: nextId(),
      input: input(kind),
      actor,
      correlationId,
      clock: fixedClock('2026-09-28T10:00:00+02:00'),
    });
    expect(result).toMatchObject({ ok: false, error: { code } });
  });

  it('lets a break end in a clock-out, ending the break there', () => {
    const punches = [
      punch('2026-09-28', '09:00', 'in'),
      punch('2026-09-28', '14:00', 'break_start'),
    ];
    const shifts = unwrap(shiftsOf([...punches, punch('2026-09-28', '14:30', 'out')], MADRID));
    expect(stateOf(shifts)).toBe('out');
  });

  it('lets the next day start while the last one was left open', () => {
    // Wednesday has no clock-out. Thursday's badge must still open a day:
    // nobody is turned away at the door for yesterday's forgotten punch.
    const shifts = unwrap(shiftsOf(week, MADRID));
    expect(shifts.map((s) => [s.date, s.out === null])).toEqual([
      ['2026-09-28', false],
      ['2026-09-29', false],
      ['2026-09-30', true],
      ['2026-10-01', true],
    ]);
  });
});

describe('one clock, whichever source punched it', () => {
  it('reads a kiosk clock-in and a web clock-out as one continuous day', () => {
    const clock = clockOf([]);
    const morning = fixedClock('2026-10-02T08:52:00+02:00');
    unwrap(
      clock.punch({
        id: nextId(),
        input: input('in', 'kiosk'),
        actor,
        correlationId,
        clock: morning,
      }),
    );
    unwrap(
      clock.punch({
        id: nextId(),
        input: input('out', 'web'),
        actor,
        correlationId,
        clock: fixedClock('2026-10-02T17:30:00+02:00'),
      }),
    );

    expect(clock.shifts).toHaveLength(1);
    expect(clock.shifts[0]?.in.source).toBe('kiosk');
    expect(clock.shifts[0]?.out?.source).toBe('web');
    expect(clock.state).toBe('out');
  });

  it('places a kiosk punch replayed late at the moment it was taken', () => {
    // The kiosk was offline and syncs its 08:52 clock-in at 11:05.
    const clock = clockOf([]);
    unwrap(
      clock.punch({
        id: nextId(),
        input: PunchInput.parse({
          kind: 'in',
          source: 'kiosk',
          workModel: 'office',
          at: at('2026-10-02', '08:52'),
        }),
        actor,
        correlationId,
        clock: fixedClock('2026-10-02T11:05:00+02:00'),
      }),
    );
    expect(clock.punches[0]?.at).toBe(at('2026-10-02', '08:52'));
    expect(clock.punches[0]?.recordedAt).toBe('2026-10-02T09:05:00.000Z');
  });

  it('raises a punch event dated the day it happened, with no coordinates', () => {
    const clock = clockOf([]);
    const id = nextId();
    unwrap(
      clock.punch({
        id,
        input: input('in', 'mobile'),
        actor,
        correlationId,
        clock: fixedClock('2026-10-01T23:30:00Z'),
      }),
    );
    const [event] = clock.drainEvents();
    // 23:30 UTC is already the 2nd in Madrid.
    expect(event).toMatchObject({
      eventId: id,
      eventName: AttendancePunched.name,
      effectiveFrom: '2026-10-02',
      occurredAt: '2026-10-01T23:30:00.000Z',
      payload: { punchId: id, kind: 'in', source: 'mobile', insideOfficeArea: null },
    });
    expect(AttendancePunched.payload.safeParse(event?.payload).success).toBe(true);
  });
});

describe('a correction supersedes and never edits', () => {
  it('replaces the punch it names and keeps the original', () => {
    const original = punch('2026-09-28', '09:00', 'in');
    const clock = clockOf([original, punch('2026-09-28', '17:00', 'out')]);
    const id = nextId();
    const corrected = unwrap(
      clock.correct({
        id,
        supersedes: original.id,
        at: at('2026-09-28', '08:30'),
        kind: 'in',
        source: 'web',
        workModel: 'office',
        reason: 'Badge reader was down',
        actor,
        correlationId,
        clock: fixedClock('2026-09-28T18:00:00+02:00'),
      }),
    );

    expect(corrected.supersedes).toBe(original.id);
    expect(clock.punches).toContain(original);
    expect(standing(clock.punches).map((p) => p.id)).not.toContain(original.id);
    expect(clock.shifts[0]?.in.at).toBe(at('2026-09-28', '08:30'));

    const [event] = clock.drainEvents();
    expect(event).toMatchObject({
      eventName: AttendanceCorrected.name,
      effectiveFrom: '2026-09-28',
      payload: { punchId: id, supersedes: original.id, reason: 'Badge reader was down' },
    });
    expect(AttendanceCorrected.payload.safeParse(event?.payload).success).toBe(true);
  });

  it('refuses a second correction of the same punch', () => {
    const original = punch('2026-09-28', '09:00', 'in');
    const clock = clockOf([original]);
    const args = {
      supersedes: original.id,
      at: at('2026-09-28', '08:30'),
      kind: 'in',
      source: 'web',
      workModel: 'office',
      reason: null,
      actor,
      correlationId,
      clock: fixedClock('2026-09-28T18:00:00+02:00'),
    } as const;
    const first = unwrap(clock.correct({ ...args, id: nextId() }));
    expect(clock.correct({ ...args, id: nextId() })).toMatchObject({
      ok: false,
      error: { code: 'ALREADY_CORRECTED', message: expect.stringContaining(first.id) as string },
    });
  });

  it('refuses one naming a punch that does not exist', () => {
    expect(
      clockOf([]).correct({
        id: nextId(),
        supersedes: nextId(),
        at: at('2026-09-28', '08:30'),
        kind: 'in',
        source: 'web',
        workModel: 'office',
        reason: null,
        actor,
        correlationId,
        clock: fixedClock('2026-09-28T18:00:00+02:00'),
      }),
    ).toMatchObject({ ok: false, error: { code: 'SUPERSEDES_UNKNOWN' } });
  });

  it('refuses one that would leave an impossible day', () => {
    const original = punch('2026-09-28', '17:00', 'out');
    const clock = clockOf([punch('2026-09-28', '09:00', 'in'), original]);
    expect(
      clock.correct({
        id: nextId(),
        supersedes: original.id,
        at: at('2026-09-28', '08:00'),
        kind: 'out',
        source: 'web',
        workModel: 'office',
        reason: null,
        actor,
        correlationId,
        clock: fixedClock('2026-09-28T18:00:00+02:00'),
      }),
    ).toMatchObject({ ok: false, error: { code: 'NOT_CLOCKED_IN' } });
  });

  it('refuses one in the future', () => {
    expect(
      clockOf([]).correct({
        id: nextId(),
        supersedes: null,
        at: at('2026-09-28', '19:00'),
        kind: 'in',
        source: 'web',
        workModel: 'office',
        reason: null,
        actor,
        correlationId,
        clock: fixedClock('2026-09-28T18:00:00+02:00'),
      }),
    ).toMatchObject({ ok: false, error: { code: 'IN_THE_FUTURE' } });
  });
});
