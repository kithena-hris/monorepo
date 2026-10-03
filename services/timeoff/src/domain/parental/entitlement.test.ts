import { describe, expect, it } from 'vitest';

import { es } from '../../country-packs/es.js';
import { date } from '../fixtures.js';
import { parentalEntitlement, type EntitlementAnswers } from './entitlement.js';

/** Adam's answers on T8: the other parent, due 14 Jan 2027, two parents, one baby, 4 years at Acme. */
const adam: EntitlementAnswers = {
  role: 'other_parent',
  childDate: date('2027-01-14'),
  singleParent: false,
  children: 1,
  pack: es.parental,
  company: { extraWeeks: 2, afterServiceYears: 1 },
  hiredOn: date('2022-09-01'),
};

describe('parental entitlement (PRD §12.1)', () => {
  it('Adam: 6 weeks after the birth, 11 before 14 Jan 2028, 2 before 2035, and Acme’s 2', () => {
    expect(parentalEntitlement(adam)).toEqual({
      law: 'ET art. 48.4, RDL 9/2025',
      mandatoryWeeks: 6,
      flexibleWeeks: 11,
      flexibleBefore: date('2028-01-14'),
      laterWeeks: 2,
      laterBefore: date('2035-01-14'),
      startsFrom: date('2027-01-14'),
      paidBy: 'social_security',
      payPercent: 100,
      companyWeeks: 2,
      vacationAccrues: true,
      noticeDays: 15,
    });
  });

  it('a single parent takes both parents’ weeks: 6 + 22 + 4', () => {
    const e = parentalEntitlement({ ...adam, singleParent: true });
    expect([e.mandatoryWeeks, e.flexibleWeeks, e.laterWeeks]).toEqual([6, 22, 4]);
  });

  it('each child after the first adds a week to each parent, both to a single parent', () => {
    expect(parentalEntitlement({ ...adam, children: 2 }).flexibleWeeks).toBe(12);
    expect(parentalEntitlement({ ...adam, children: 3 }).flexibleWeeks).toBe(13);
    expect(parentalEntitlement({ ...adam, children: 2, singleParent: true }).flexibleWeeks).toBe(
      24,
    );
  });

  it('the company’s weeks wait for the service it asks for', () => {
    expect(parentalEntitlement({ ...adam, hiredOn: date('2026-03-01') }).companyWeeks).toBe(0);
    expect(parentalEntitlement({ ...adam, hiredOn: date('2026-01-14') }).companyWeeks).toBe(2);
    expect(parentalEntitlement({ ...adam, company: null }).companyWeeks).toBe(0);
  });

  it('the birth parent may start up to 4 weeks before the due date; nobody else may', () => {
    expect(parentalEntitlement({ ...adam, role: 'birth_parent' }).startsFrom).toBe(
      date('2026-12-17'),
    );
    expect(parentalEntitlement({ ...adam, role: 'adopting' }).startsFrom).toBe(date('2027-01-14'));
  });
});
