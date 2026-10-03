import { describe, expect, it } from 'vitest';
import { DayAmount, LeaveApproved, LeaveRequested, LeaveTypeKey } from '@kithena/contracts';

import { ADAM, context, date, TENANT } from '../fixtures.js';
import { leaveRequestId } from './leave-request.js';
import { recordSick, type SickLeaveType } from './sick.js';

const HANA_ACCOUNT = '88888888-8888-7888-8888-888888888888';
const sick: SickLeaveType = {
  key: LeaveTypeKey.parse('sick'),
  category: 'sick_leave',
  tracked: false,
  paid: 'statutory',
  unit: 'day',
  requiresNote: { afterDays: 3 },
};

const record = (
  from: string,
  to: string,
  workingDays: string,
  over: Partial<Parameters<typeof recordSick>[0]> = {},
) =>
  recordSick(
    {
      id: leaveRequestId('b3f1c2d4-0000-7000-8000-000000000001'),
      tenantId: TENANT,
      personId: ADAM,
      leaveType: sick,
      span: {
        from: date(from),
        to: date(to),
        startsHalfDay: false,
        endsHalfDay: false,
        workingDays: DayAmount.parse(workingDays),
      },
      sickNoteFileId: null,
      recordedBy: HANA_ACCOUNT,
      jurisdiction: 'ES',
      ...over,
    },
    context(),
  );

describe('recordSick', () => {
  it('approves a 2-day sick record on creation, asking for no note (T16, Hana)', () => {
    const result = record('2026-10-01', '2026-10-02', '2.000');
    if (!result.ok) throw new Error(result.error.message);
    const { request, entries, noteRequired } = result.value;
    expect(request.status).toBe('approved');
    expect(noteRequired).toBe(false);
    expect(entries).toEqual([]);
    expect(request.drainEvents().map((e) => e.eventName)).toEqual([
      LeaveRequested.name,
      LeaveApproved.name,
    ]);
  });

  it('asks for a note on a 4-day record, and leaves it for the manager', () => {
    const result = record('2026-10-01', '2026-10-06', '4.000');
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.noteRequired).toBe(true);
    expect(result.value.request.status).toBe('pending');
  });

  it('counts the note threshold in calendar days, the weekend included (EFZG §5, SSP fit note)', () => {
    // Thursday to Monday: three working days, five in a row.
    const result = record('2026-10-01', '2026-10-05', '3.000');
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.noteRequired).toBe(true);
  });

  it('asks for nothing more once the note is attached, and the note never leaves', () => {
    const fileId = '0189ffff-0000-7000-8000-00000000f11e';
    const result = record('2026-10-01', '2026-10-06', '4.000', { sickNoteFileId: fileId });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.noteRequired).toBe(false);
    const events = result.value.request.drainEvents();
    expect(events[0]?.payload).toMatchObject({ notePresent: true });
    expect(JSON.stringify(events)).not.toContain(fileId);
  });

  it('pays statutory sick leave as statutory', () => {
    const result = record('2026-10-01', '2026-10-01', '1.000');
    if (!result.ok) throw new Error(result.error.message);
    const approved = result.value.request
      .drainEvents()
      .find((e) => e.eventName === LeaveApproved.name);
    expect(approved?.payload).toMatchObject({
      approvedBy: HANA_ACCOUNT,
      payroll: { paid: true, statutory: true },
    });
  });

  it('approves nothing automatically when the tenant switched that off', () => {
    const result = record('2026-10-01', '2026-10-01', '1.000', { autoApproveUnderDays: null });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.request.status).toBe('pending');
  });

  it('refuses a leave type that is not sick leave', () => {
    const result = record('2026-10-01', '2026-10-01', '1.000', {
      leaveType: { ...sick, key: LeaveTypeKey.parse('vacation'), category: 'annual_leave' },
    });
    if (result.ok) throw new Error('expected a refusal');
    expect(result.error.code).toBe('NOT_SICK_LEAVE');
  });
});
