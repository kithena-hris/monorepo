import { describe, expect, it } from 'vitest';
import { Instant, LeaveTypeDefinition, PunchInput, type PunchKind } from '@kithena/contracts';

import { LeaveType } from '../../domain/policy/leave-type.js';
import { caller, d, hr, people, TENANT, world } from '../testing/world.js';
import {
  attendanceExceptions,
  correctPunch,
  decideOvertime,
  punch,
  teamRightNow,
  timesheet,
} from './attendance.js';
import { inspectorExport } from './inspector-files.js';

const adam = caller(people.adam);
const marco = caller(people.marco);

function setup() {
  const app = world('2026-10-05T07:00:00.000Z');
  const comp = LeaveType.define(
    LeaveTypeDefinition.parse({
      key: 'comp',
      name: { default: 'Comp time' },
      category: 'other',
      colorToken: 'chart-5',
      icon: 'timer',
      unit: 'hour',
      tracked: true,
      paid: 'paid',
      visibility: 'type',
    }),
  );
  if (!comp.ok) throw new Error(comp.error.message);
  app.state(TENANT).leaveTypes.set('comp', comp.value);
  const at = (iso: string, kind: PunchKind) => {
    app.clock.set(iso);
    return punch(app.deps)(adam, PunchInput.parse({ kind, source: 'web', workModel: 'office' }));
  };
  return { app, at };
}

describe('the clock and the timesheet (TOF-042)', () => {
  it('runs a full day, a forgotten clock-out and its correction', async () => {
    const { app, at } = setup();
    // Monday 5 October, Madrid: in at 09:00, a break 13:30–14:00, and no clock-out.
    expect(await at('2026-10-05T07:00:00.000Z', 'in')).toMatchObject({
      ok: true,
      value: { state: 'in' },
    });
    expect(await at('2026-10-05T11:30:00.000Z', 'break_start')).toMatchObject({
      ok: true,
      value: { state: 'on_break' },
    });
    expect(await at('2026-10-05T12:00:00.000Z', 'break_end')).toMatchObject({
      ok: true,
      value: { state: 'in' },
    });

    // Tuesday morning: Monday is open, and Adam says he left at 18:00.
    app.clock.set('2026-10-06T06:30:00.000Z');
    const sheet = timesheet(app.deps);
    const before = await sheet(adam, {
      personId: people.adam,
      from: d('2026-10-05'),
      to: d('2026-10-05'),
    });
    expect(before.ok && before.value.open).toEqual([
      { date: '2026-10-05', lastPunchAt: '2026-10-05T12:00:00.000Z' },
    ]);

    const corrected = await correctPunch(app.deps)(adam, {
      personId: people.adam,
      supersedes: null,
      at: Instant.parse('2026-10-05T16:00:00.000Z'),
      kind: 'out',
      reason: 'Forgot to clock out',
    });
    expect(corrected).toMatchObject({ ok: true, value: { needsManager: false } });

    const after = await sheet(adam, {
      personId: people.adam,
      from: d('2026-10-05'),
      to: d('2026-10-11'),
    });
    if (!after.ok) throw new Error(after.error.message);
    expect(after.value.open).toEqual([]);
    expect(after.value.days[0]).toMatchObject({
      status: 'complete',
      workedMinutes: 510,
      breakMinutes: 30,
      plannedMinutes: 480,
      overtimeMinutes: 30,
    });
    expect(after.value.weeks).toEqual([
      expect.objectContaining({ monday: '2026-10-05', workedMinutes: 510 }),
    ]);
    expect(after.value.corrections).toHaveLength(1);
    expect(app.state(TENANT).events.map((e) => e.eventName)).toEqual([
      'timeoff.attendance.punched',
      'timeoff.attendance.punched',
      'timeoff.attendance.punched',
      'timeoff.attendance.corrected',
    ]);

    // Only Adam, his approver or HR read it.
    expect(
      await sheet(caller(people.omar), {
        personId: people.adam,
        from: d('2026-10-05'),
        to: d('2026-10-05'),
      }),
    ).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  });

  it('shows the manager the team right now, and the overtime waiting for him', async () => {
    const { app, at } = setup();
    await at('2026-10-05T07:00:00.000Z', 'in');
    await at('2026-10-05T16:00:00.000Z', 'out');
    await at('2026-10-06T07:15:00.000Z', 'in');

    const board = await teamRightNow(app.deps)(marco);
    if (!board.ok) throw new Error(board.error.message);
    expect(board.value.people.find((p) => p.personId === people.adam)).toMatchObject({
      state: 'in',
      workModel: 'office',
      today: { status: 'live' },
    });
    expect(board.value.people.find((p) => p.personId === people.omar)).toMatchObject({
      state: 'out',
    });
    expect(board.value.needsYou).toEqual([
      { kind: 'overtime', personId: people.adam, date: '2026-10-05', minutes: 60 },
    ]);
    expect(await teamRightNow(app.deps)(adam)).toMatchObject({ ok: true, value: { people: [] } });
  });

  it('banks approved overtime as comp time, once, and only the approver decides', async () => {
    const { app, at } = setup();
    await at('2026-10-05T07:00:00.000Z', 'in');
    await at('2026-10-05T16:00:00.000Z', 'out');
    const decide = decideOvertime(app.deps);
    const input = {
      personId: people.adam,
      date: d('2026-10-05'),
      approve: true,
      choice: 'comp' as const,
    };

    expect(await decide(adam, input)).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(await decide(marco, input)).toMatchObject({
      ok: true,
      value: { outcome: 'comp', minutes: 60 },
    });
    expect(await decide(marco, input)).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });

    const s = app.state(TENANT);
    expect(s.ledger.map((e) => [e.kind, e.amount, e.unit])).toEqual([
      ['comp_earned', '1.000', 'hour'],
    ]);
    expect(s.lines).toEqual([expect.objectContaining({ compMinutes: 60, workedMinutes: 540 })]);
    expect([...s.periods.values()]).toEqual([
      expect.objectContaining({ from: '2026-10-01', to: '2026-10-31', closedAt: null }),
    ]);
  });
});

describe('HR’s exceptions and the inspector’s record (TOF-095)', () => {
  async function adamsWeek() {
    const { app, at } = setup();
    // Monday 09:00–18:00, an hour over; Tuesday in at 09:00 and never out.
    await at('2026-10-05T07:00:00.000Z', 'in');
    await at('2026-10-05T16:00:00.000Z', 'out');
    await at('2026-10-06T07:00:00.000Z', 'in');
    app.clock.set('2026-10-08T07:00:00.000Z');
    return app;
  }
  const october = { from: d('2026-10-01'), to: d('2026-10-31') };

  it('lists only what needs HR, oldest first, and nobody else may ask', async () => {
    const app = await adamsWeek();
    const found = await attendanceExceptions(app.deps)(hr, october);
    if (!found.ok) throw new Error(found.error.message);
    expect(found.value.items.map((e) => [e.kind, e.date, e.minutes, e.displayName])).toEqual([
      ['overtime_waiting', '2026-10-05', 60, 'Adam Novak'],
      ['missed_clock_out', '2026-10-06', null, 'Adam Novak'],
    ]);
    expect(await attendanceExceptions(app.deps)(marco, october)).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
    expect(
      await attendanceExceptions(app.deps)(hr, { from: d('2026-01-01'), to: d('2027-06-01') }),
    ).toMatchObject({ ok: false, error: { code: 'PERIOD_TOO_LONG' } });
  });

  it('gives the inspector each day’s start, end and breaks, as CSV and as PDF', async () => {
    const app = await adamsWeek();
    const csv = await inspectorExport(app.deps)(hr, { ...october, format: 'csv' });
    if (!csv.ok) throw new Error(csv.error.message);
    expect(csv.value.name).toBe('working-time-2026-10-01-to-2026-10-31.csv');
    expect(Buffer.from(csv.value.base64, 'base64').toString('utf8').split('\r\n')).toEqual([
      'Person,Date,Start,End,Breaks,Break minutes,Worked',
      'Adam Novak,2026-10-05,09:00,18:00,,0,9:00',
      'Adam Novak,2026-10-06,09:00,,,0,',
      '',
    ]);
    const pdf = await inspectorExport(app.deps)(hr, { ...october, format: 'pdf' });
    if (!pdf.ok) throw new Error(pdf.error.message);
    expect(pdf.value.contentType).toBe('application/pdf');
    expect(Buffer.from(pdf.value.base64, 'base64').subarray(0, 5).toString()).toBe('%PDF-');
    expect(await inspectorExport(app.deps)(adam, { ...october, format: 'csv' })).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
  });
});
