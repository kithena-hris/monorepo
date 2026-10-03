import { describe, expect, it } from 'vitest';
import { DayAmount, NegativeBalanceRule } from '@kithena/contracts';

import { date } from '../fixtures.js';
import { goingBelowZero } from './negative.js';

/** T31: up to 3 days, vacation only, manager then HR, from next year's allowance. */
const t31 = NegativeBalanceRule.parse({ limit: '3.000' });
const d = (value: string) => DayAmount.parse(value);

/** T5: Mon 14 – Wed 23 Dec, 8 working days (the 8th and the 25th are holidays). */
const december = ['14', '15', '16', '17', '18', '21', '22', '23'].map((day) =>
  date(`2026-12-${day}`),
);

describe('goingBelowZero', () => {
  it('fits when the balance covers the cost', () => {
    const { verdict } = goingBelowZero({
      rule: t31,
      left: d('11.500'),
      cost: d('5.000'),
      nextYearAllowance: d('25.000'),
      workingDates: [],
    });
    expect(verdict).toEqual({ kind: 'fits' });
  });

  it('borrows T5: 6.5 left and 8 requested borrows 1.5, 2027 starts at 23.5, manager then HR', () => {
    const { verdict } = goingBelowZero({
      rule: t31,
      left: d('6.500'),
      cost: d('8.000'),
      nextYearAllowance: d('25.000'),
      workingDates: december,
    });
    expect(verdict).toEqual({
      kind: 'borrow',
      days: '1.500',
      nextYearStartsAt: '23.500',
      approvers: ['manager', 'hr'],
    });
  });

  it('offers T5 its alternatives: 1.5 unpaid, or shortened to the 6.5 that fit', () => {
    const { alternatives } = goingBelowZero({
      rule: t31,
      left: d('6.500'),
      cost: d('8.000'),
      nextYearAllowance: d('25.000'),
      workingDates: december,
    });
    expect(alternatives).toEqual({
      unpaid: { days: '1.500' },
      shorten: { to: '2026-12-22', endsHalfDay: true, days: '6.500' },
    });
  });

  it('refuses 10 requested against 6.5 left, at a limit of 3', () => {
    const { verdict } = goingBelowZero({
      rule: t31,
      left: d('6.500'),
      cost: d('10.000'),
      nextYearAllowance: d('25.000'),
      workingDates: [],
    });
    expect(verdict).toEqual({ kind: 'refused', limit: '3.000' });
  });

  it('borrows exactly up to the limit', () => {
    const { verdict } = goingBelowZero({
      rule: t31,
      left: d('6.500'),
      cost: d('9.500'),
      nextYearAllowance: d('25.000'),
      workingDates: [],
    });
    expect(verdict.kind).toBe('borrow');
  });

  it('counts what an already negative balance has borrowed against the limit', () => {
    const { verdict } = goingBelowZero({
      rule: t31,
      left: d('-2.000'),
      cost: d('1.500'),
      nextYearAllowance: d('25.000'),
      workingDates: [],
    });
    expect(verdict).toEqual({ kind: 'refused', limit: '3.000' });
  });

  it('refuses any borrowing, at a limit of 0, when the policy does not allow it', () => {
    const { verdict } = goingBelowZero({
      rule: null,
      left: d('6.500'),
      cost: d('8.000'),
      nextYearAllowance: d('25.000'),
      workingDates: [],
    });
    expect(verdict).toEqual({ kind: 'refused', limit: '0.000' });
  });

  it.each([
    ['manager', ['manager']],
    ['hr', ['hr']],
  ] as const)('routes a borrow to %s alone when the rule says so', (approvers, expected) => {
    const rule = NegativeBalanceRule.parse({ limit: '3.000', approvers });
    const { verdict } = goingBelowZero({
      rule,
      left: d('6.500'),
      cost: d('8.000'),
      nextYearAllowance: d('25.000'),
      workingDates: [],
    });
    expect(verdict.kind === 'borrow' && verdict.approvers).toEqual(expected);
  });

  it('says nothing about next year when the borrowed days end up unpaid or written off', () => {
    const rule = NegativeBalanceRule.parse({ limit: '3.000', atYearEnd: 'unpaid' });
    const { verdict } = goingBelowZero({
      rule,
      left: d('6.500'),
      cost: d('8.000'),
      nextYearAllowance: d('25.000'),
      workingDates: [],
    });
    expect(verdict.kind === 'borrow' && verdict.nextYearStartsAt).toBeNull();
  });

  it('offers no shortening when nothing is left, nor without half days for a half', () => {
    const none = goingBelowZero({
      rule: t31,
      left: d('0.000'),
      cost: d('2.000'),
      nextYearAllowance: d('25.000'),
      workingDates: december.slice(0, 2),
    });
    expect(none.alternatives.shorten).toBeNull();
    const whole = goingBelowZero({
      rule: t31,
      left: d('6.500'),
      cost: d('8.000'),
      nextYearAllowance: d('25.000'),
      workingDates: december,
      halfDays: false,
    });
    expect(whole.alternatives.shorten).toEqual({
      to: '2026-12-21',
      endsHalfDay: false,
      days: '6.000',
    });
  });
});
