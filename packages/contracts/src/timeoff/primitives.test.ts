import { describe, expect, it } from 'vitest';

import {
  AbsenceKind,
  DayAmount,
  HourAmount,
  LeaveCategory,
  LeaveTypeKey,
  NonNegativeDayAmount,
  PunchKind,
  AttendanceWorkModel,
} from './primitives.js';

/**
 * The words Time Off is written in. Mostly refusals, because each one is a
 * value that would otherwise reach a ledger row, a payroll export and a Kafka
 * payload before anybody noticed it was wrong.
 */
describe('a day amount', () => {
  it('is a decimal string with three places, which is what numeric(9,3) prints', () => {
    for (const ok of ['25.000', '2.080', '0.500', '-1.500', '0.000', '999999.999']) {
      expect(DayAmount.safeParse(ok).success, ok).toBe(true);
    }
  });

  it('refuses a float, so 25/12 never travels as 2.0833333333333335', () => {
    expect(DayAmount.safeParse(2.08).success).toBe(false);
    expect(DayAmount.safeParse(25).success).toBe(false);
  });

  it('refuses a negative zero, which folds to the same balance and reads as a debt', () => {
    expect(DayAmount.safeParse('-0.000').success).toBe(false);
  });

  it('refuses any other number of places, so one value has one spelling', () => {
    for (const bad of ['2.08', '2', '2.0800', '.500', '02.000', '1e3', '', ' 1.000']) {
      expect(DayAmount.safeParse(bad).success, bad).toBe(false);
    }
  });

  it('refuses more than numeric(9,3) can hold', () => {
    expect(DayAmount.safeParse('1000000.000').success).toBe(false);
  });

  it('has a non-negative form for limits and allowances', () => {
    expect(NonNegativeDayAmount.safeParse('3.000').success).toBe(true);
    expect(NonNegativeDayAmount.safeParse('-3.000').success).toBe(false);
  });

  it('shares its spelling with hours', () => {
    expect(HourAmount.safeParse('7.500').success).toBe(true);
    expect(HourAmount.safeParse(7.5).success).toBe(false);
  });
});

describe('a leave type key', () => {
  it('accepts the shipped keys', () => {
    for (const key of ['vacation', 'personal', 'sick', 'parental', 'comp', 'unpaid']) {
      expect(LeaveTypeKey.safeParse(key).success, key).toBe(true);
    }
  });

  it('refuses a hyphen, an uppercase letter and a leading digit', () => {
    for (const bad of ['comp-time', 'Vacation', '2nd_vacation', '']) {
      expect(LeaveTypeKey.safeParse(bad).success, bad).toBe(false);
    }
  });
});

describe('a leave category', () => {
  it('is an absence kind, so a consumer that knows no tenant types still understands it', () => {
    for (const category of LeaveCategory.options) {
      expect(AbsenceKind.safeParse(category).success).toBe(true);
    }
  });

  it('is never a public holiday, which belongs to a calendar and not to a leave type', () => {
    expect(LeaveCategory.safeParse('public_holiday').success).toBe(false);
  });
});

describe('a punch', () => {
  it('has the four kinds and the three work models', () => {
    expect(PunchKind.options).toEqual(['in', 'out', 'break_start', 'break_end']);
    expect(AttendanceWorkModel.options).toEqual(['office', 'remote', 'client']);
  });
});
