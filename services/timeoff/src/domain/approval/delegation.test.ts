import { describe, expect, it } from 'vitest';
import type { CalendarDate } from '@kithena/contracts';

import { date, MARCO, NORA, OMAR } from '../fixtures.js';
import { escalation, routeTo, type Delegation } from './delegation.js';

/** T19: Omar covers Marco, set automatically whenever Marco's own time off is approved. */
const automatic: Delegation = {
  approverId: MARCO,
  delegateId: OMAR,
  range: null,
  automatic: true,
  salaryRelated: false,
};
const marcoAway = [{ from: date('2026-10-13'), to: date('2026-10-16') }];

/** Weekdays, and 12 Oct (Spain's national day) off. */
const isWorkingDay = (d: CalendarDate): boolean => {
  const day = new Date(`${d}T00:00:00Z`).getUTCDay();
  return day !== 0 && day !== 6 && d !== '2026-10-12';
};

describe('routeTo', () => {
  it('routes Adam’s request to Omar while Marco is away 13–16 Oct', () => {
    expect(
      routeTo({
        approverId: MARCO,
        on: date('2026-10-14'),
        delegation: automatic,
        approverAway: marcoAway,
        salaryRelated: false,
      }),
    ).toEqual({
      kind: 'delegate',
      personId: OMAR,
      onBehalfOf: MARCO,
    });
  });

  it('routes to Marco himself once he is back', () => {
    expect(
      routeTo({
        approverId: MARCO,
        on: date('2026-10-19'),
        delegation: automatic,
        approverAway: marcoAway,
        salaryRelated: false,
      }),
    ).toEqual({
      kind: 'approver',
      personId: MARCO,
    });
  });

  it('covers a set range whether or not the approver is off', () => {
    const ranged: Delegation = {
      ...automatic,
      automatic: false,
      range: { from: date('2026-10-13'), to: date('2026-10-16') },
    };
    expect(
      routeTo({
        approverId: MARCO,
        on: date('2026-10-13'),
        delegation: ranged,
        approverAway: [],
        salaryRelated: false,
      }).kind,
    ).toBe('delegate');
    expect(
      routeTo({
        approverId: MARCO,
        on: date('2026-10-17'),
        delegation: ranged,
        approverAway: [],
        salaryRelated: false,
      }).kind,
    ).toBe('approver');
  });

  it('does not follow time off when automatic delegation is off', () => {
    const manual: Delegation = { ...automatic, automatic: false };
    expect(
      routeTo({
        approverId: MARCO,
        on: date('2026-10-14'),
        delegation: manual,
        approverAway: marcoAway,
        salaryRelated: false,
      }).kind,
    ).toBe('approver');
  });

  it('sends a salary-related request to HR instead of the delegate, unless allowed', () => {
    const args = {
      approverId: MARCO,
      on: date('2026-10-14'),
      approverAway: marcoAway,
      salaryRelated: true,
    };
    expect(routeTo({ ...args, delegation: automatic })).toEqual({ kind: 'hr', onBehalfOf: MARCO });
    expect(routeTo({ ...args, delegation: { ...automatic, salaryRelated: true } }).kind).toBe(
      'delegate',
    );
  });

  it('routes to the approver with no delegate set', () => {
    expect(
      routeTo({
        approverId: MARCO,
        on: date('2026-10-14'),
        delegation: null,
        approverAway: marcoAway,
        salaryRelated: false,
      }).kind,
    ).toBe('approver');
  });
});

describe('escalation', () => {
  it('escalates a request untouched for 3 working days to the approver’s manager', () => {
    // Sent Thu 8 Oct: Fri 9, Tue 13 (Mon 12 is a holiday), Wed 14.
    expect(
      escalation({ pendingSince: date('2026-10-08'), approverManagerId: NORA, isWorkingDay }),
    ).toEqual({
      on: date('2026-10-14'),
      to: { kind: 'person', personId: NORA },
    });
  });

  it('counts only working days, so a weekend does not hurry it', () => {
    expect(
      escalation({ pendingSince: date('2026-10-16'), approverManagerId: NORA, isWorkingDay }).on,
    ).toBe('2026-10-21');
  });

  it('takes another number of working days when the tenant sets one', () => {
    expect(
      escalation({
        pendingSince: date('2026-10-19'),
        approverManagerId: NORA,
        isWorkingDay,
        afterWorkingDays: 1,
      }).on,
    ).toBe('2026-10-20');
  });

  it('goes to HR when the approver has no manager', () => {
    expect(
      escalation({ pendingSince: date('2026-10-19'), approverManagerId: null, isWorkingDay }).to,
    ).toEqual({ kind: 'hr' });
  });
});
