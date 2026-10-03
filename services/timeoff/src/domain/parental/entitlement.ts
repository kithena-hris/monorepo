import type { CalendarDate } from '@kithena/contracts';

import { tenureOn } from '../balance/entitlement.js';
import { addDays, addMonths } from '../days.js';

/**
 * What a parent is entitled to, in plain numbers (PRD §12.1, T8): the law in
 * the member's country plus the company's own policy. Read straight from the
 * country pack's data, so a second country is a second pack, not a branch here.
 */

/** A country pack's parental rules: the shape the pack's data fills in (es.ts). */
export interface ParentalRules {
  readonly law: string;
  readonly paidBy: string;
  readonly payPercent: number;
  readonly twoParents: Weeks;
  readonly singleParent: Weeks;
  readonly flexibleUntilMonths: number;
  readonly laterUntilYears: number;
  readonly birthParentMayStartWeeksBefore: number;
  /** Per child after the first. */
  readonly extraWeeks: { readonly twoParents: number; readonly singleParent: number };
  readonly noticeDays: number;
  readonly vacationAccrues: boolean;
}

interface Weeks {
  readonly mandatoryWeeks: number;
  readonly flexibleWeeks: number;
  readonly laterWeeks: number;
}

export type ParentRole = 'birth_parent' | 'other_parent' | 'adopting';

/** Extra paid weeks a company adds once a member has served long enough. */
export interface CompanyParentalPolicy {
  readonly extraWeeks: number;
  readonly afterServiceYears: number;
}

export interface EntitlementAnswers {
  readonly role: ParentRole;
  /** The due date, the recorded birth, or the adoption or fostering decision. */
  readonly childDate: CalendarDate;
  readonly singleParent: boolean;
  /** Children born or placed together: 2 for twins. */
  readonly children: number;
  readonly pack: ParentalRules;
  readonly company: CompanyParentalPolicy | null;
  readonly hiredOn: CalendarDate;
}

export interface ParentalEntitlement {
  readonly law: string;
  /** Full time, straight after `childDate`. */
  readonly mandatoryWeeks: number;
  /** Whole weeks, ending before `flexibleBefore`. */
  readonly flexibleWeeks: number;
  readonly flexibleBefore: CalendarDate;
  /** Whole weeks, ending before the child turns `pack.laterUntilYears`. */
  readonly laterWeeks: number;
  readonly laterBefore: CalendarDate;
  /** The earliest a statutory block may start: before the due date only for the birth parent. */
  readonly startsFrom: CalendarDate;
  readonly paidBy: string;
  readonly payPercent: number;
  readonly companyWeeks: number;
  readonly vacationAccrues: boolean;
  /** Notice owed before each flexible block. */
  readonly noticeDays: number;
}

export function parentalEntitlement(a: EntitlementAnswers): ParentalEntitlement {
  const { pack } = a;
  const row = a.singleParent ? pack.singleParent : pack.twoParents;
  const extra =
    (a.singleParent ? pack.extraWeeks.singleParent : pack.extraWeeks.twoParents) *
    Math.max(0, a.children - 1);
  const served =
    a.company !== null && tenureOn(a.hiredOn, a.childDate) >= a.company.afterServiceYears;
  return {
    law: pack.law,
    mandatoryWeeks: row.mandatoryWeeks,
    flexibleWeeks: row.flexibleWeeks + extra,
    flexibleBefore: addMonths(a.childDate, pack.flexibleUntilMonths),
    laterWeeks: row.laterWeeks,
    laterBefore: addMonths(a.childDate, pack.laterUntilYears * 12),
    startsFrom:
      a.role === 'birth_parent'
        ? addDays(a.childDate, -7 * pack.birthParentMayStartWeeksBefore)
        : a.childDate,
    paidBy: pack.paidBy,
    payPercent: pack.payPercent,
    companyWeeks: served ? a.company.extraWeeks : 0,
    vacationAccrues: pack.vacationAccrues,
    noticeDays: pack.noticeDays,
  };
}
