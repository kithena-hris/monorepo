import { describe, expect, it } from 'vitest';

import {
  isLeaveStart,
  leavingReasonOf,
  lifecycleNote,
  lifecycleOf,
  rehireOf,
  statusOf,
} from './lifecycle.js';

/**
 * An HR export's employment lifecycle columns, read onto People's own
 * lifecycle: offboarding from a termination date, notice until one ahead,
 * leave from its start. The dates decide where the status word disagrees.
 */

const TODAY = '2026-10-03';
const row = (over: Partial<Parameters<typeof lifecycleOf>[0]>) =>
  lifecycleOf({
    status: null,
    hireDate: '2020-01-06',
    lastWorkingDay: null,
    reason: '',
    rehire: '',
    leaveStart: null,
    today: TODAY,
    ...over,
  });

describe('the status words other systems export', () => {
  it.each([
    ['Active', 'active'],
    ['Employed', 'active'],
    ['Pre-hire', 'pre_hire'],
    ['Prehire', 'pre_hire'],
    ['On leave', 'on_leave'],
    ['Leave of absence', 'on_leave'],
    ['LOA', 'on_leave'],
    ['Notice period', 'notice'],
    ['On notice', 'notice'],
    ['Terminated', 'terminated'],
    ['Inactive', 'terminated'],
    ['Former employee', 'terminated'],
    ['', null],
    ['Seconded', null],
  ])('%s is %s', (cell, status) => {
    expect(statusOf(cell)).toBe(status);
  });
});

describe('a termination reason, onto People’s three', () => {
  it.each([
    ['Resignation - personal', 'resigned'],
    ['Resignation - new opportunity', 'resigned'],
    ['Voluntary', 'resigned'],
    ['Retirement', 'resigned'],
    ['Involuntary - restructuring', 'dismissed'],
    ['Dismissed for cause', 'dismissed'],
    ['Redundancy', 'dismissed'],
    ['Layoff', 'dismissed'],
    ['End of contract', 'end_of_contract'],
    ['Fixed-term contract ended', 'end_of_contract'],
    ['', 'resigned'],
  ])('%s is %s', (cell, reason) => {
    expect(leavingReasonOf(cell)).toBe(reason);
  });
});

describe('eligible for rehire', () => {
  it.each([
    ['Yes', true],
    ['Y', true],
    ['true', true],
    ['No', false],
    ['N', false],
    ['', null],
    ['Maybe', null],
  ])('%s is %s', (cell, value) => {
    expect(rehireOf(cell)).toBe(value);
  });
});

describe('the leave start column, found by its header', () => {
  it.each(['Leave Start Date', 'Leave start', 'Leave from', 'Start of leave'])('%s', (h) => {
    expect(isLeaveStart(h)).toBe(true);
  });
  it.each(['Start Date', 'Leave Type', 'Expected Return Date'])('not %s', (h) => {
    expect(isLeaveStart(h)).toBe(false);
  });
});

describe('what the row does to the person', () => {
  it('a leaver is offboarded from their termination date, with the reason and the rehire flag', () => {
    expect(
      row({
        status: 'terminated',
        lastWorkingDay: '2024-05-18',
        reason: 'Involuntary - restructuring',
        rehire: 'Yes',
      }),
    ).toEqual({
      move: {
        kind: 'left',
        lastWorkingDay: '2024-05-18',
        reason: 'dismissed',
        note: 'Involuntary - restructuring',
        eligibleForRehire: true,
      },
      conflict: null,
    });
  });

  it('a leaving day of today has come: left', () => {
    expect(row({ status: 'terminated', lastWorkingDay: TODAY }).move?.kind).toBe('left');
  });

  it('notice with a termination date ahead: offboarding scheduled for that day', () => {
    expect(
      row({ status: 'notice', lastWorkingDay: '2026-11-30', reason: 'Resignation - personal' }),
    ).toEqual({
      move: { kind: 'notice', lastWorkingDay: '2026-11-30', reason: 'resigned' },
      conflict: null,
    });
  });

  it('on leave from its start date', () => {
    expect(row({ status: 'on_leave', leaveStart: '2026-06-11' })).toEqual({
      move: { kind: 'leave', from: '2026-06-11' },
      conflict: null,
    });
  });

  it('on leave with no start date: from today, as People puts somebody on leave', () => {
    expect(row({ status: 'on_leave' }).move).toEqual({ kind: 'leave', from: TODAY });
  });

  it('a leave that began before the start date began with it', () => {
    expect(row({ status: 'on_leave', leaveStart: '2019-01-01' }).move).toEqual({
      kind: 'leave',
      from: '2020-01-06',
    });
  });

  it.each(['active', null] as const)('%s with no dates moves nobody', (status) => {
    expect(row({ status })).toEqual({ move: null, conflict: null });
  });

  it('pre-hire with a start date ahead moves nobody', () => {
    expect(row({ status: 'pre_hire', hireDate: '2026-12-06' })).toEqual({
      move: null,
      conflict: null,
    });
  });

  describe('the dates decide where the status disagrees', () => {
    it('“Active” with a start date ahead: pre-hire, and nothing else moves', () => {
      expect(row({ status: 'active', hireDate: '2026-12-01' })).toEqual({
        move: null,
        conflict: 'starts_later',
      });
      expect(
        row({ status: 'terminated', hireDate: '2026-12-01', lastWorkingDay: '2026-12-31' }),
      ).toEqual({ move: null, conflict: 'starts_later' });
    });

    it('“Pre-hire” with a start date behind: active', () => {
      expect(row({ status: 'pre_hire' })).toEqual({ move: null, conflict: 'started' });
    });

    it('“Active” with a termination date behind: left', () => {
      expect(row({ status: 'active', lastWorkingDay: '2025-03-01' })).toEqual({
        move: {
          kind: 'left',
          lastWorkingDay: '2025-03-01',
          reason: 'resigned',
          note: null,
          eligibleForRehire: null,
        },
        conflict: 'left_by_date',
      });
    });

    it('“Notice period” with a termination date behind: left', () => {
      expect(row({ status: 'notice', lastWorkingDay: '2026-09-30' }).move?.kind).toBe('left');
      expect(row({ status: 'notice', lastWorkingDay: '2026-09-30' }).conflict).toBe('left_by_date');
    });

    it('“Terminated” with a termination date ahead: serving notice', () => {
      expect(row({ status: 'terminated', lastWorkingDay: '2026-12-31' })).toEqual({
        move: { kind: 'notice', lastWorkingDay: '2026-12-31', reason: 'resigned' },
        conflict: 'notice_by_date',
      });
    });

    it('a termination date with no status column at all is the dates’ to decide, quietly', () => {
      expect(row({ lastWorkingDay: '2025-03-01' }).conflict).toBeNull();
      expect(row({ lastWorkingDay: '2026-12-31' }).move?.kind).toBe('notice');
    });

    it('“Terminated” with no termination date: active, for HR to offboard', () => {
      expect(row({ status: 'terminated' })).toEqual({ move: null, conflict: 'no_last_day' });
      expect(row({ status: 'notice' })).toEqual({ move: null, conflict: 'no_last_day' });
    });

    it('a termination date before the start date: active, for HR', () => {
      expect(row({ status: 'terminated', lastWorkingDay: '2019-12-31' })).toEqual({
        move: null,
        conflict: 'last_day_before_hire',
      });
    });

    it('“On leave” from a day ahead: active until then', () => {
      expect(row({ status: 'on_leave', leaveStart: '2026-11-01' })).toEqual({
        move: null,
        conflict: 'leave_later',
      });
    });

    it('no start date at all: nothing moves, whatever the status', () => {
      expect(row({ status: 'terminated', hireDate: null, lastWorkingDay: '2024-01-01' })).toEqual({
        move: null,
        conflict: 'no_start',
      });
    });
  });
});

describe('a conflict, in one line of the plan', () => {
  it.each([
    [
      'starts_later',
      2,
      '2 people with a start date ahead are pre-hire until then, whatever the status says.',
    ],
    ['started', 1, '1 person marked pre-hire has started: active from their start date.'],
    [
      'left_by_date',
      3,
      '3 people with a termination date behind them are offboarded from it, whatever the status says.',
    ],
    [
      'notice_by_date',
      1,
      '1 person marked terminated leaves on a day ahead, so is serving notice until then.',
    ],
    [
      'no_last_day',
      2,
      '2 people marked as leaving have no termination date: active, for HR to offboard from their record.',
    ],
    [
      'last_day_before_hire',
      1,
      '1 person has a termination date before their start date: active, for HR to check.',
    ],
    ['leave_later', 1, '1 person’s leave starts later: active until then.'],
    ['no_start', 1, '1 person has no start date, so their status waits until HR hires them.'],
  ] as const)('%s', (code, n, line) => {
    expect(lifecycleNote(code, n)).toBe(line);
  });
});
