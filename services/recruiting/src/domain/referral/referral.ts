import type { CalendarDate } from '@kithena/contracts';

import { addMonths } from '../dates.js';

/**
 * Referrals and agencies (Recruiting PRD §9.3, §9.4, REC-036).
 */

export type ReferralOutcome = 'in_progress' | 'hired' | 'not_hired';

/** The referrer sees whether the referral was hired, never the stages or the reasons. */
export function referralOutcome(
  applicationOutcome: 'active' | 'hired' | 'rejected' | 'withdrawn',
): ReferralOutcome {
  return applicationOutcome === 'hired'
    ? 'hired'
    : applicationOutcome === 'active'
      ? 'in_progress'
      : 'not_hired';
}

export interface ReferralBonusRule {
  readonly amountMinor: number;
  readonly currency: string;
  /** Paid after the hire passes probation, or after N months. */
  readonly after:
    { readonly kind: 'probation' } | { readonly kind: 'months'; readonly months: number };
}

/** When a referral bonus falls due; paying it is Payroll's. */
export function bonusDueOn(
  rule: ReferralBonusRule,
  start: CalendarDate,
  probationEnd: CalendarDate | null,
): CalendarDate {
  return rule.after.kind === 'probation'
    ? (probationEnd ?? start)
    : addMonths(start, rule.after.months);
}

export interface Submission {
  readonly agencyId: string;
  readonly email: string;
  readonly submittedOn: CalendarDate;
}

/**
 * Agency ownership (PRD §9.4): the first submission of a candidate, matched
 * by email, owns them for the period (default 6 months). A duplicate is
 * refused with the date of the earlier one.
 */
export function ownership(
  incoming: Submission,
  earlier: readonly Submission[],
  months = 6,
):
  | { readonly accepted: true }
  | { readonly accepted: false; readonly ownedBy: string; readonly since: CalendarDate } {
  const email = incoming.email.trim().toLowerCase();
  const owner = earlier
    .filter(
      (s) =>
        s.email.trim().toLowerCase() === email &&
        addMonths(s.submittedOn, months) > incoming.submittedOn,
    )
    .toSorted((a, b) => a.submittedOn.localeCompare(b.submittedOn))[0];
  return owner === undefined
    ? { accepted: true }
    : { accepted: false, ownedBy: owner.agencyId, since: owner.submittedOn };
}

/** An agency's fee: a percentage of first-year base, in basis points, or a fixed fee. */
export type AgencyFee =
  | { readonly kind: 'percent'; readonly basisPoints: number }
  | { readonly kind: 'fixed'; readonly amountMinor: number };

export const feeMinor = (fee: AgencyFee, firstYearBaseMinor: number): number =>
  fee.kind === 'fixed'
    ? fee.amountMinor
    : Math.round((firstYearBaseMinor * fee.basisPoints) / 10_000);
