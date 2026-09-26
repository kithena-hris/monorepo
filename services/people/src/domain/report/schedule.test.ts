import { describe, expect, it } from 'vitest';

import {
  checkSchedule,
  duePeriod,
  latestPeriod,
  mayManage,
  type Schedule,
  type ScheduleInput,
} from './schedule.js';

/**
 * A scheduled report (PRD §16.3, PEO-069): when it is due, on whose clock,
 * and what the backend does when it wakes having slept through its hour.
 */

const PRIYA = '00000000-0000-4000-8000-0000000000b1';
const MARCO = '00000000-0000-4000-8000-0000000000b2';

const input = (over: Partial<ScheduleInput> = {}): ScheduleInput => ({
  name: 'Weekly roster',
  audience: { filter: {} },
  report: { kind: 'export', format: 'xlsx', fields: null, reason: null },
  cadence: { every: 'week', weekday: 1, hour: 7 },
  legalEntityId: null,
  recipients: [PRIYA],
  ...over,
});

const schedule = (over: Partial<Schedule> = {}): Schedule => ({
  id: '00000000-0000-4000-8000-0000000000c1',
  ownerAccountId: PRIYA,
  paused: false,
  lastPeriod: '2026-09-01',
  ...input(),
  ...over,
});

describe('checkSchedule', () => {
  it('keeps a valid schedule, name trimmed and recipients deduplicated', () => {
    const checked = checkSchedule(input({ name: '  Roster ', recipients: [PRIYA, MARCO, PRIYA] }));
    expect(checked).toMatchObject({
      ok: true,
      value: { name: 'Roster', recipients: [PRIYA, MARCO] },
    });
  });

  it('refuses nobody to send to, and more than 25', () => {
    expect(checkSchedule(input({ recipients: [] }))).toMatchObject({
      ok: false,
      error: { code: 'SCHEDULE_RECIPIENTS' },
    });
    const many = Array.from(
      { length: 26 },
      (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    );
    expect(checkSchedule(input({ recipients: many })).ok).toBe(false);
  });

  it('refuses an hour, weekday or day of month that is not on a calendar', () => {
    for (const cadence of [
      { every: 'day', hour: 24 },
      { every: 'week', weekday: 0, hour: 7 },
      { every: 'month', day: 29, hour: 7 },
      { every: 'month', day: 1, hour: 1.5 },
    ] as const) {
      expect(checkSchedule(input({ cadence })).ok).toBe(false);
    }
  });

  it('refuses a summary over a hand-typed filter: the summary is the analytics screen, which takes a segment', () => {
    expect(
      checkSchedule(input({ report: { kind: 'summary' }, audience: { filter: { a: 'b' } } })),
    ).toMatchObject({ ok: false, error: { code: 'SCHEDULE_AUDIENCE' } });
    expect(checkSchedule(input({ report: { kind: 'summary' } })).ok).toBe(true);
  });

  it('refuses a filter a directory query could not carry', () => {
    expect(checkSchedule(input({ audience: { filter: { 'Bad Key': 'x' } } })).ok).toBe(false);
    expect(checkSchedule(input({ audience: { filter: { city: 'a,b' } } })).ok).toBe(false);
  });
});

describe('mayManage', () => {
  it('is HR and People administrators: a schedule is the tenant’s, not a person’s', () => {
    expect(mayManage(new Set(['hr']))).toBe(true);
    expect(mayManage(new Set(['people_admin']))).toBe(true);
    expect(mayManage(new Set(['finance']))).toBe(false);
    expect(mayManage(new Set())).toBe(false);
  });
});

describe('latestPeriod', () => {
  const MADRID = 'Europe/Madrid';

  it('is today once the hour has come on the zone’s clock, yesterday before', () => {
    const daily = { every: 'day', hour: 7 } as const;
    // 05:30 UTC is 07:30 in Madrid (CEST) and 01:30 in New York.
    expect(latestPeriod(daily, MADRID, '2026-09-23T05:30:00Z')).toBe('2026-09-23');
    expect(latestPeriod(daily, 'America/New_York', '2026-09-23T05:30:00Z')).toBe('2026-09-22');
  });

  it('is the most recent weekday for a weekly one', () => {
    // Wednesday 23 September; Mondays at 07:00.
    const weekly = { every: 'week', weekday: 1, hour: 7 } as const;
    expect(latestPeriod(weekly, MADRID, '2026-09-23T12:00:00Z')).toBe('2026-09-21');
    // Monday 21 September at 06:00 Madrid: last week's.
    expect(latestPeriod(weekly, MADRID, '2026-09-21T04:00:00Z')).toBe('2026-09-14');
  });

  it('is this month’s day once passed, last month’s before, across a year', () => {
    const monthly = { every: 'month', day: 15, hour: 7 } as const;
    expect(latestPeriod(monthly, MADRID, '2026-09-23T12:00:00Z')).toBe('2026-09-15');
    expect(latestPeriod(monthly, MADRID, '2026-01-10T12:00:00Z')).toBe('2025-12-15');
  });
});

describe('duePeriod', () => {
  const daily = { every: 'day', hour: 7 } as const;
  const zone = 'Etc/UTC';

  it('is nothing while the latest period has already run, or while paused', () => {
    const at = '2026-09-23T12:00:00Z';
    expect(duePeriod(schedule({ cadence: daily, lastPeriod: '2026-09-23' }), zone, at)).toBeNull();
    expect(
      duePeriod(schedule({ cadence: daily, lastPeriod: '2026-09-22', paused: true }), zone, at),
    ).toBeNull();
  });

  it('is the next period once its hour comes', () => {
    expect(
      duePeriod(
        schedule({ cadence: daily, lastPeriod: '2026-09-22' }),
        zone,
        '2026-09-23T07:00:00Z',
      ),
    ).toEqual({ period: '2026-09-23', missed: 0 });
  });

  it('after a sleep, is the latest period only, counting the ones it covers', () => {
    // Last sent on the 18th; the backend slept until the 23rd.
    expect(
      duePeriod(
        schedule({ cadence: daily, lastPeriod: '2026-09-18' }),
        zone,
        '2026-09-23T12:00:00Z',
      ),
    ).toEqual({ period: '2026-09-23', missed: 4 });
    const weekly = { every: 'week', weekday: 1, hour: 7 } as const;
    expect(
      duePeriod(
        schedule({ cadence: weekly, lastPeriod: '2026-08-31' }),
        zone,
        '2026-09-23T12:00:00Z',
      ),
    ).toEqual({ period: '2026-09-21', missed: 2 });
    const monthly = { every: 'month', day: 1, hour: 7 } as const;
    expect(
      duePeriod(
        schedule({ cadence: monthly, lastPeriod: '2025-11-01' }),
        zone,
        '2026-02-02T00:00:00Z',
      ),
    ).toEqual({ period: '2026-02-01', missed: 2 });
  });
});
