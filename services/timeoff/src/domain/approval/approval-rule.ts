import type {
  DayAmount,
  LeaveCategory,
  LeaveTypeDefinition,
  LeaveTypeKey,
} from '@kithena/contracts';

import { days } from '../days.js';

/**
 * Who approves what (PRD §9.1, T34).
 *
 * A rule reads like a sentence — Request → Manager → HR — and resolves to an
 * ordered list of roles. Which person holds "manager" is the member's
 * `managerPersonId` from the projection, and checking that they may is
 * OpenFGA's job in the application layer; this only says which roles, in
 * which order. An empty list is approved automatically.
 */

export type ApproverRole = 'manager' | 'hr';

export interface ApprovalRule {
  readonly subject: 'request' | 'plan' | 'timesheet';
  /** `null` is every leave type. */
  readonly leaveTypes: readonly LeaveTypeKey[] | null;
  readonly when: 'always' | 'below_zero' | 'unpaid';
  readonly approvers: readonly ApproverRole[];
}

/** "Approved automatically" (T34), with its defaults. */
export interface AutoApproval {
  readonly shortenOrCancel: boolean;
  /** Sick leave under this many days; `null` when off. */
  readonly sickUnderDays: number | null;
  readonly oneDayAboveMinimum: boolean;
}

export const DEFAULT_AUTO_APPROVAL: AutoApproval = {
  shortenOrCancel: true,
  sickUnderDays: 3,
  oneDayAboveMinimum: false,
};

export interface ApprovalCase {
  readonly subject: ApprovalRule['subject'];
  readonly action: 'request' | 'change' | 'shorten' | 'cancel';
  readonly leaveTypeKey: LeaveTypeKey | null;
  readonly category: LeaveCategory | null;
  readonly paid: LeaveTypeDefinition['paid'];
  readonly workingDays: DayAmount;
  readonly belowZero: boolean;
  readonly hasManager: boolean;
  /** The team stays above its minimum on every day (TOF-018's answer). */
  readonly teamAboveMinimum: boolean;
}

/** The tenant default when no rule names the case. */
const DEFAULT_CHAIN: readonly ApproverRole[] = ['manager'];

function matches(rule: ApprovalRule, c: ApprovalCase): boolean {
  if (rule.subject !== c.subject) return false;
  if (
    rule.leaveTypes !== null &&
    (c.leaveTypeKey === null || !rule.leaveTypes.includes(c.leaveTypeKey))
  )
    return false;
  if (rule.when === 'below_zero') return c.belowZero;
  if (rule.when === 'unpaid') return c.paid === 'unpaid';
  return true;
}

function automatic(auto: AutoApproval, c: ApprovalCase): boolean {
  if (c.subject !== 'request') return false;
  if ((c.action === 'shorten' || c.action === 'cancel') && auto.shortenOrCancel) return true;
  if (c.action !== 'request') return false;
  const cost = days(c.workingDays);
  if (c.category === 'sick_leave' && auto.sickUnderDays !== null && cost.lt(auto.sickUnderDays))
    return true;
  return (
    auto.oneDayAboveMinimum &&
    c.category === 'annual_leave' &&
    !c.belowZero &&
    cost.lte(1) &&
    c.teamAboveMinimum
  );
}

/**
 * The ordered roles that must approve, `[]` for automatic. A rule with a
 * condition beats one that always applies, so "vacation below zero" wins over
 * "vacation" whatever order they were saved in. A member without a manager
 * falls through to HR.
 */
export function resolveApprovers(
  rules: readonly ApprovalRule[],
  auto: AutoApproval,
  c: ApprovalCase,
): readonly ApproverRole[] {
  if (automatic(auto, c)) return [];
  const matching = rules.filter((r) => matches(r, c));
  const rule = matching.find((r) => r.when !== 'always') ?? matching[0];
  const chain = rule?.approvers ?? DEFAULT_CHAIN;
  if (c.hasManager) return chain;
  return [...new Set(chain.map((role) => (role === 'manager' ? 'hr' : role)))];
}
