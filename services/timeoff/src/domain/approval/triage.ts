import { HourAmount, type CalendarDate, type DayAmount, type LeaveCategory, type LeaveUnit } from '@kithena/contracts';

import { amount, days } from '../days.js';

/**
 * "Waiting for me", split into Clear to approve and Look closer (PRD §9.2,
 * T16).
 *
 * Deterministic: a request is clear when it is within balance (or comp time
 * within the hours banked), keeps the team at its minimum every day, misses
 * every protected period, and is sick leave under the threshold. Otherwise
 * the first rule that fails is the reason, typed, with the numbers the
 * sentence on screen is written from. Coverage comes in as the days below
 * minimum, because TOF-018 computes it.
 */

export interface TriageItem {
  readonly category: LeaveCategory;
  readonly unit: LeaveUnit;
  /** In the leave type's unit: days, or hours for comp time. */
  readonly cost: string;
  /** What is left before this request, in the same unit; `null` for an untracked type. */
  readonly left: string | null;
  readonly daysBelowMinimum: readonly CalendarDate[];
  /** The request's days inside a protected period, such as a release. */
  readonly protectedDays?: readonly CalendarDate[];
}

export type LookCloser =
  | { readonly rule: 'below_zero'; readonly by: DayAmount }
  | { readonly rule: 'over_banked'; readonly short: HourAmount }
  | { readonly rule: 'below_minimum'; readonly days: readonly CalendarDate[] }
  | { readonly rule: 'protected_period'; readonly days: readonly CalendarDate[] }
  | { readonly rule: 'sick_over_threshold'; readonly days: DayAmount };

export type Triage = { readonly group: 'clear' } | { readonly group: 'look_closer'; readonly reason: LookCloser };

const closer = (reason: LookCloser): Triage => ({ group: 'look_closer', reason });

export function triage(item: TriageItem, rules: { readonly sickUnderDays: number } = { sickUnderDays: 3 }): Triage {
  if (item.left !== null) {
    const short = days(item.cost).minus(item.left);
    if (short.gt(0)) {
      return item.unit === 'hour'
        ? closer({ rule: 'over_banked', short: HourAmount.parse(amount(short)) })
        : closer({ rule: 'below_zero', by: amount(short) });
    }
  }
  if (item.daysBelowMinimum.length > 0) return closer({ rule: 'below_minimum', days: item.daysBelowMinimum });
  const protectedDays = item.protectedDays ?? [];
  if (protectedDays.length > 0) return closer({ rule: 'protected_period', days: protectedDays });
  if (item.category === 'sick_leave' && days(item.cost).gte(rules.sickUnderDays)) {
    return closer({ rule: 'sick_over_threshold', days: amount(item.cost) });
  }
  return { group: 'clear' };
}

/** The queue in its two groups, each keeping the order it came in. */
export function splitQueue<T>(
  items: readonly T[],
  triageOf: (item: T) => Triage,
): { clear: T[]; lookCloser: { item: T; reason: LookCloser }[] } {
  const clear: T[] = [];
  const lookCloser: { item: T; reason: LookCloser }[] = [];
  for (const item of items) {
    const result = triageOf(item);
    if (result.group === 'clear') clear.push(item);
    else lookCloser.push({ item, reason: result.reason });
  }
  return { clear, lookCloser };
}
