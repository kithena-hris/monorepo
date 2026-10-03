import {
  CalendarDate,
  type DayAmount,
  type LedgerEntry,
  type LeaveUnit,
  type PersonId,
  type PolicyDefinition,
} from '@kithena/contracts';

import type { EventContext } from '../context.js';
import { addDays, addMonths, amount, ceilHalf, days, daysBetween, Decimal, sum } from '../days.js';
import { entry } from './ledger.js';

/**
 * What a policy version grants a member for one leave year (PRD §6.2, §7.1):
 * the grant or the monthly accruals, and the carry-over in.
 *
 * Pro-rata counts months, a part month by its days, because "a joiner on
 * 1 Jul gets 12.5 of 25" is what HR expects and a count of days gives 12.6.
 * The year's total is rounded up to the half day; monthly credits are rounded
 * cumulatively, so twelve credits of 2.083 or 2.084 sum to exactly 25.
 */

export interface Member {
  readonly personId: PersonId;
  readonly hireDate: CalendarDate;
  readonly terminationDate: CalendarDate | null;
}

interface Month {
  readonly starts: CalendarDate;
  /** The day it is credited: its start, or the hire date in the joining month. */
  readonly credited: CalendarDate;
  /** The share of the month employed, 0 to 1. */
  readonly fraction: Decimal;
  /** The allowance of the tenure band on the credit day. */
  readonly band: Decimal;
}

/** Whole years of service on a date. */
function tenureOn(hire: CalendarDate, on: CalendarDate): number {
  const years = Number(on.slice(0, 4)) - Number(hire.slice(0, 4));
  return on.slice(5) < hire.slice(5) ? years - 1 : years;
}

function bandOn(policy: PolicyDefinition, hire: CalendarDate, on: CalendarDate): Decimal {
  const years = tenureOn(hire, on);
  const band = policy.allowance.findLast((b) => b.fromYears <= years) ?? policy.allowance[0];
  return days(band?.days ?? '0.000');
}

/** The year's start on the policy's month and day. */
const yearStart = (policy: PolicyDefinition, year: number): CalendarDate =>
  CalendarDate.parse(
    `${String(year)}-${String(policy.year.month).padStart(2, '0')}-${String(policy.year.day).padStart(2, '0')}`,
  );

function months(policy: PolicyDefinition, member: Member, year: number): Month[] {
  const start = yearStart(policy, year);
  const end = addDays(addMonths(start, 12), -1);
  const lastDay =
    member.terminationDate !== null && member.terminationDate < end ? member.terminationDate : end;
  const firstDay = member.hireDate > start ? member.hireDate : start;
  if (firstDay > lastDay) return [];
  const clamp = (d: CalendarDate) => (d < firstDay ? firstDay : d > lastDay ? lastDay : d);
  return Array.from({ length: 12 }, (_, k) => {
    const starts = addMonths(start, k);
    const ends = addDays(addMonths(start, k + 1), -1);
    const from = clamp(starts);
    const to = clamp(ends);
    const employed = starts <= lastDay && ends >= firstDay ? daysBetween(from, to) : 0;
    // Without pro-rata, every month of a year someone works in counts whole.
    const fraction = policy.proRata
      ? new Decimal(employed).div(daysBetween(starts, ends))
      : new Decimal(1);
    return { starts, credited: from, fraction, band: bandOn(policy, member.hireDate, from) };
  }).filter((m) => m.fraction.gt(0));
}

/** Allowance × share employed, month by month, before any rounding. */
const earned = (ms: readonly Month[], band?: Decimal): Decimal =>
  sum(ms.map((m) => m.fraction.times(band ?? m.band).div(12)));

export function entitlement(
  args: {
    readonly policy: PolicyDefinition;
    readonly policyVersion: number;
    readonly member: Member;
    /** The calendar year the leave year starts in. */
    readonly year: number;
    readonly unit?: LeaveUnit;
    /** Last year's closing balance, for the carry-over. */
    readonly carriedIn?: DayAmount | null;
  },
  ctx: Pick<EventContext, 'newId' | 'clock'>,
): LedgerEntry[] {
  const { policy, member } = args;
  const ms = months(policy, member, args.year);
  const first = ms[0];
  if (first === undefined) return [];

  const post = (kind: LedgerEntry['kind'], value: Decimal, effectiveOn: CalendarDate) =>
    entry(
      {
        personId: member.personId,
        leaveTypeKey: policy.leaveTypeKey,
        unit: args.unit ?? 'day',
        kind,
        amount: value,
        effectiveOn,
        policyVersion: args.policyVersion,
      },
      ctx,
    );
  // 25/12 has no exact decimal, so six of them sum a hair past 12.5; trimmed
  // well below a thousandth first, or the half-day round-up turns 25.5 into 26.
  const round = (value: Decimal) => {
    const trimmed = value.toDecimalPlaces(9);
    return policy.proRata ? ceilHalf(trimmed) : trimmed;
  };
  const yearTotal = round(earned(ms));
  const entries: LedgerEntry[] = [];

  const start = yearStart(policy, args.year);
  const cap = policy.carryOver?.maxDays;
  if (cap !== undefined && args.carriedIn && member.hireDate < start) {
    const carried = Decimal.min(days(args.carriedIn), days(cap));
    if (carried.gt(0)) entries.push(post('carry_over', carried, start));
  }

  if (policy.earning === 'upfront') {
    // The band on the first day, then one top-up where a tenure band begins.
    const grant = round(earned(ms, first.band));
    entries.push(post('grant', grant, first.credited));
    const boundary = ms.find((m) => !m.band.eq(first.band));
    if (boundary && yearTotal.gt(grant))
      entries.push(post('grant', yearTotal.minus(grant), boundary.starts));
    return entries;
  }

  let creditedSoFar = new Decimal(0);
  let running = new Decimal(0);
  ms.forEach((m, i) => {
    running = running.plus(m.fraction.times(m.band).div(12));
    const target = i === ms.length - 1 ? yearTotal : running.toDecimalPlaces(3);
    entries.push(post('accrual', target.minus(creditedSoFar), m.credited));
    creditedSoFar = target;
  });
  return entries;
}

/**
 * Carried days still unused on the use-by date expire then (PRD §6.2).
 * Carried days are used first, so this is what was carried less what was
 * taken by that date, or `null` when nothing is left to lose.
 */
export function carryOverExpiry(
  args: {
    readonly ledger: readonly LedgerEntry[];
    readonly policy: PolicyDefinition;
    readonly year: number;
  },
  ctx: Pick<EventContext, 'newId' | 'clock'>,
): LedgerEntry | null {
  const rule = args.policy.carryOver;
  const carried = args.ledger.filter((e) => e.kind === 'carry_over');
  const first = carried[0];
  if (rule === null || first === undefined) return null;
  const useBy = CalendarDate.parse(
    `${String(args.year)}-${String(rule.useBy.month).padStart(2, '0')}-${String(rule.useBy.day).padStart(2, '0')}`,
  );
  const taken = sum(
    args.ledger
      .filter((e) => e.kind === 'taken' && e.effectiveOn <= useBy)
      .map((e) => days(e.amount)),
  ).neg();
  const unused = sum(carried.map((e) => days(e.amount))).minus(taken);
  if (unused.lte(0)) return null;
  return entry(
    {
      personId: first.personId,
      leaveTypeKey: first.leaveTypeKey,
      unit: first.unit,
      kind: 'expiry',
      amount: amount(unused.neg()),
      effectiveOn: useBy,
    },
    ctx,
  );
}
