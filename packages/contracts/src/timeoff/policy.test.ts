import { describe, expect, it } from 'vitest';

import { LeaveTypeDefinition, PolicyDefinition, TimeOffPredicate } from './policy.js';

/**
 * Leave types and policies (PRD §6.1, §6.2, §7.4). The two properties the
 * ticket names are the two that fail late if they are not refused here: an
 * operand nobody can evaluate, and a limit that would let a balance go up by
 * borrowing.
 */

/** T30 and T31, as the design shows them. */
const vacationPolicy = {
  leaveTypeKey: 'vacation',
  allowance: [
    { fromYears: 0, days: '25.000' },
    { fromYears: 3, days: '26.000' },
    { fromYears: 6, days: '27.000' },
    { fromYears: 10, days: '28.000' },
  ],
  earning: 'monthly',
  carryOver: { maxDays: '5.000', useBy: { month: 3, day: 31 } },
  negativeBalance: { limit: '3.000' },
};

const at = (allowance: unknown) => PolicyDefinition.safeParse({ ...vacationPolicy, allowance });

describe('an applies-to predicate', () => {
  it('refuses an unknown operand when the rule is written, not when it is evaluated', () => {
    expect(
      TimeOffPredicate.safeParse({ clauses: [{ operand: 'favouriteColour', in: ['blue'] }] })
        .success,
    ).toBe(false);
  });

  it('refuses something written as an expression', () => {
    // No user-authored expressions: a string where a clause belongs is refused.
    expect(TimeOffPredicate.safeParse({ clauses: ["country == 'ES'"] }).success).toBe(false);
  });

  it('refuses a value the operand cannot take', () => {
    expect(
      TimeOffPredicate.safeParse({ clauses: [{ operand: 'country', in: ['madrid'] }] }).success,
    ).toBe(false);
  });

  it('accepts the populations the PRD names', () => {
    const parsed = TimeOffPredicate.parse({
      clauses: [
        { operand: 'country', in: ['ES'] },
        { operand: 'employmentType', in: ['permanent'] },
        { operand: 'location', in: ['madrid'] },
      ],
    });
    expect(parsed.combine).toBe('all');
  });
});

describe('a policy', () => {
  it('parses T30 with the defaults the PRD sets', () => {
    const parsed = PolicyDefinition.parse(vacationPolicy);
    expect(parsed.year).toEqual({ month: 1, day: 1 });
    expect(parsed.keepEarningOnParental).toBe(true);
    expect(parsed.requests.blockBelowMinimum).toBe(false);
    expect(parsed.negativeBalance?.approvers).toBe('manager_then_hr');
    expect(parsed.negativeBalance?.atYearEnd).toBe('next_year');
    expect(parsed.negativeBalance?.onLeaving).toBe('final_pay');
    expect(parsed.appliesTo).toBeNull();
  });

  it('refuses a negative-balance limit below zero', () => {
    expect(
      PolicyDefinition.safeParse({ ...vacationPolicy, negativeBalance: { limit: '-3.000' } })
        .success,
    ).toBe(false);
  });

  it('refuses tenure bands that do not start at zero or do not climb', () => {
    expect(at([{ fromYears: 3, days: '26.000' }]).success).toBe(false);
    expect(
      at([
        { fromYears: 0, days: '25.000' },
        { fromYears: 0, days: '26.000' },
      ]).success,
    ).toBe(false);
    expect(at([]).success).toBe(false);
  });

  it('refuses a year that starts on a day no year has', () => {
    expect(
      PolicyDefinition.safeParse({ ...vacationPolicy, year: { month: 2, day: 30 } }).success,
    ).toBe(false);
  });
});

describe('a leave type', () => {
  it('parses sick leave, untracked and shown to teammates only as Off', () => {
    const parsed = LeaveTypeDefinition.parse({
      key: 'sick',
      name: { default: 'Sick leave' },
      category: 'sick_leave',
      colorToken: 'chart-4',
      icon: 'thermometer',
      tracked: false,
      paid: 'paid',
      visibility: 'off_only',
      requiresNote: { afterDays: 3 },
      statutory: true,
    });
    expect(parsed.unit).toBe('day');
    expect(parsed.appliesTo).toBeNull();
  });

  it('refuses a colour that is not a Reach token', () => {
    expect(
      LeaveTypeDefinition.safeParse({
        key: 'vacation',
        name: { default: 'Vacation' },
        category: 'annual_leave',
        colorToken: '#ff0000',
        icon: 'sun',
        tracked: true,
        paid: 'paid',
      }).success,
    ).toBe(false);
  });
});
