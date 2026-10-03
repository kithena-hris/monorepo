import { describe, expect, it } from 'vitest';
import { DayAmount, LeaveTypeKey } from '@kithena/contracts';

import { DEFAULT_AUTO_APPROVAL, resolveApprovers, type ApprovalCase, type ApprovalRule } from './approval-rule.js';

const key = (k: string) => LeaveTypeKey.parse(k);

/** T34, "Who approves", as drawn. */
const T34: readonly ApprovalRule[] = [
  { subject: 'request', leaveTypes: [key('vacation')], when: 'always', approvers: ['manager'] },
  { subject: 'request', leaveTypes: [key('vacation')], when: 'below_zero', approvers: ['manager', 'hr'] },
  { subject: 'request', leaveTypes: null, when: 'unpaid', approvers: ['manager', 'hr'] },
  { subject: 'plan', leaveTypes: [key('parental')], when: 'always', approvers: ['hr'] },
  { subject: 'timesheet', leaveTypes: null, when: 'always', approvers: ['manager'] },
];

const vacation: ApprovalCase = {
  subject: 'request',
  action: 'request',
  leaveTypeKey: key('vacation'),
  category: 'annual_leave',
  paid: 'paid',
  workingDays: DayAmount.parse('5.000'),
  belowZero: false,
  hasManager: true,
  teamAboveMinimum: true,
};

const resolve = (c: Partial<ApprovalCase>) => resolveApprovers(T34, DEFAULT_AUTO_APPROVAL, { ...vacation, ...c });

describe('resolveApprovers', () => {
  it('T34: vacation goes to the manager', () => {
    expect(resolve({})).toEqual(['manager']);
  });

  it('T34: vacation below zero goes to the manager, then HR', () => {
    expect(resolve({ belowZero: true })).toEqual(['manager', 'hr']);
  });

  it('T34: unpaid goes to the manager, then HR', () => {
    expect(resolve({ leaveTypeKey: key('unpaid'), category: 'unpaid_leave', paid: 'unpaid' })).toEqual(['manager', 'hr']);
  });

  it('T34: a parental plan goes to HR', () => {
    expect(resolve({ subject: 'plan', leaveTypeKey: key('parental'), category: 'parental_leave', paid: 'statutory' })).toEqual(['hr']);
  });

  it('T34: overtime on a timesheet goes to the manager', () => {
    expect(resolve({ subject: 'timesheet', leaveTypeKey: null, category: null })).toEqual(['manager']);
  });

  it('resolves a shorten, or a cancel, to no approver', () => {
    expect(resolve({ action: 'shorten' })).toEqual([]);
    expect(resolve({ action: 'cancel', belowZero: true })).toEqual([]);
  });

  it('sends a shorten through the request rule when its automatic approval is off', () => {
    expect(resolveApprovers(T34, { ...DEFAULT_AUTO_APPROVAL, shortenOrCancel: false }, { ...vacation, action: 'shorten' })).toEqual(['manager']);
  });

  it('approves sick leave under 3 days automatically, and sends a longer one to the manager', () => {
    const sick = { leaveTypeKey: key('sick'), category: 'sick_leave' as const, paid: 'statutory' as const };
    expect(resolve({ ...sick, workingDays: DayAmount.parse('2.000') })).toEqual([]);
    expect(resolve({ ...sick, workingDays: DayAmount.parse('3.000') })).toEqual(['manager']);
  });

  it('approves one day of vacation automatically only when switched on and the team holds', () => {
    const one = { workingDays: DayAmount.parse('1.000') };
    expect(resolve(one)).toEqual(['manager']);
    const on = { ...DEFAULT_AUTO_APPROVAL, oneDayAboveMinimum: true };
    expect(resolveApprovers(T34, on, { ...vacation, ...one })).toEqual([]);
    expect(resolveApprovers(T34, on, { ...vacation, ...one, teamAboveMinimum: false })).toEqual(['manager']);
  });

  it('falls through to HR for a member without a manager', () => {
    expect(resolve({ hasManager: false })).toEqual(['hr']);
    expect(resolve({ hasManager: false, belowZero: true })).toEqual(['hr']);
  });

  it('sends a request no rule names to the manager, the tenant default', () => {
    expect(resolve({ leaveTypeKey: key('personal'), category: 'other' })).toEqual(['manager']);
  });
});
