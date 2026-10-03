import type { CalendarDate, DayAmount, NegativeBalanceRule } from '@kithena/contracts';

import { amount, days, Decimal } from '../days.js';

/**
 * Going below zero (PRD §7.4, T5, T31).
 *
 * A request that would cross zero is a choice, not an error: borrow within
 * the policy's limit, make the difference unpaid, or shorten to what fits.
 * Only a request beyond the limit is refused, and the refusal carries the
 * limit so the message can say it. Money is left out: Phase 1 does not know a
 * daily rate, so it shows days rather than invent euros.
 */

export type Approver = 'manager' | 'hr';

export type NegativeVerdict =
  | { readonly kind: 'fits' }
  | {
      readonly kind: 'borrow';
      /** How far below zero this request goes. */
      readonly days: DayAmount;
      /** Next year's opening balance, when borrowed days come out of it. */
      readonly nextYearStartsAt: DayAmount | null;
      readonly approvers: readonly Approver[];
    }
  | { readonly kind: 'refused'; readonly limit: DayAmount };

export interface Alternatives {
  /** Book what fits and take the rest unpaid. */
  readonly unpaid: { readonly days: DayAmount } | null;
  /** End the request on the last day the balance covers. */
  readonly shorten: { readonly to: CalendarDate; readonly endsHalfDay: boolean; readonly days: DayAmount } | null;
}

const APPROVERS: Record<NegativeBalanceRule['approvers'], readonly Approver[]> = {
  manager: ['manager'],
  manager_then_hr: ['manager', 'hr'],
  hr: ['hr'],
};

export function goingBelowZero(args: {
  /** `null` when the policy does not let anyone below zero. */
  readonly rule: NegativeBalanceRule | null;
  readonly left: DayAmount;
  readonly cost: DayAmount;
  readonly nextYearAllowance: DayAmount;
  /** The request's working days in order, each costing one, for "shorten". */
  readonly workingDates: readonly CalendarDate[];
  readonly halfDays?: boolean;
}): { verdict: NegativeVerdict; alternatives: Alternatives } {
  const left = days(args.left);
  const after = left.minus(args.cost);
  if (after.gte(0)) return { verdict: { kind: 'fits' }, alternatives: { unpaid: null, shorten: null } };

  const covered = Decimal.max(left, 0);
  const alternatives: Alternatives = {
    unpaid: { days: amount(days(args.cost).minus(covered)) },
    shorten: shorten(covered, args.workingDates, args.halfDays ?? true),
  };

  const limit = days(args.rule?.limit ?? '0.000');
  if (args.rule === null || after.neg().gt(limit)) {
    return { verdict: { kind: 'refused', limit: amount(limit) }, alternatives };
  }
  return {
    verdict: {
      kind: 'borrow',
      days: amount(days(args.cost).minus(covered)),
      nextYearStartsAt: args.rule.atYearEnd === 'next_year' ? amount(days(args.nextYearAllowance).plus(after)) : null,
      approvers: APPROVERS[args.rule.approvers],
    },
    alternatives,
  };
}

function shorten(covered: Decimal, dates: readonly CalendarDate[], halfDays: boolean): Alternatives['shorten'] {
  const whole = covered.floor().toNumber();
  const half = halfDays && covered.minus(whole).gte(0.5);
  const to = half ? dates[whole] : dates[whole - 1];
  if (to === undefined) return null;
  return { to, endsHalfDay: half, days: amount(half ? new Decimal(whole).plus('0.5') : whole) };
}
