import type { CalendarDate, DayAmount, PersonId, TeamKey } from '@kithena/contracts';

import { amount, days, sum } from '../days.js';

/**
 * Insights (PRD §14.2, T27): the domain computes every number of the month
 * summary — unbooked days and who would lose some, who has had no break,
 * how missed clock-outs and overtime moved — and the writer only says it.
 *
 * **A group smaller than the tenant's cohort minimum is never described**
 * (People's rule): a point may name a team only when the people it counts
 * there reach the minimum, and per-team figures leave the small teams out.
 */

/** One member, as the summary reads them. */
export interface Facts {
  readonly personId: PersonId;
  readonly team: TeamKey | null;
  readonly hireDate: CalendarDate;
  /** The last day of annual leave taken or booked, up to today; `null` for none this year. */
  readonly lastDayOff: CalendarDate | null;
  /** Annual leave left this leave year. */
  readonly left: DayAmount;
  /** Lost at the year end above the carry-over cap, if nothing more is booked. */
  readonly losesAtYearEnd: DayAmount;
}

/** A month of the scope, oldest first; the last is this month. */
export interface Monthly {
  /** `YYYY-MM`. */
  readonly month: string;
  readonly vacation: DayAmount;
  readonly personal: DayAmount;
  readonly sick: DayAmount;
  readonly missedClockOuts: number;
  readonly overtimeMinutes: number;
}

export type Point =
  | {
      readonly kind: 'unbooked';
      /** Annual leave still unbooked across the scope. */
      readonly days: DayAmount;
      /** Who would lose some at the year end. */
      readonly personIds: readonly PersonId[];
    }
  | {
      readonly kind: 'no_break';
      readonly since: CalendarDate;
      readonly personIds: readonly PersonId[];
      /** The team most of them are in, when that many reach the cohort minimum. */
      readonly largestTeam: { readonly team: TeamKey; readonly count: number } | null;
    }
  | { readonly kind: 'missed_clock_outs'; readonly thisMonth: number; readonly lastMonth: number }
  | {
      readonly kind: 'overtime';
      readonly thisMonthMinutes: number;
      readonly lastMonthMinutes: number;
    };

export function whatChanged(args: {
  readonly facts: readonly Facts[];
  readonly months: readonly Monthly[];
  /** "No day off since": people who joined after it are not counted. */
  readonly since: CalendarDate;
  readonly cohortMinimum: number;
}): Point[] {
  const points: Point[] = [];
  const unbooked = sum(args.facts.map((f) => days(f.left)).filter((n) => n.gt(0)));
  if (unbooked.gt(0)) {
    points.push({
      kind: 'unbooked',
      days: amount(unbooked),
      personIds: args.facts.filter((f) => days(f.losesAtYearEnd).gt(0)).map((f) => f.personId),
    });
  }

  const tired = args.facts.filter(
    (f) => f.hireDate < args.since && (f.lastDayOff === null || f.lastDayOff < args.since),
  );
  if (tired.length > 0) {
    const byTeam = new Map<TeamKey, number>();
    for (const f of tired) if (f.team !== null) byTeam.set(f.team, (byTeam.get(f.team) ?? 0) + 1);
    const [team, count] = [...byTeam].toSorted((a, b) => b[1] - a[1])[0] ?? [null, 0];
    points.push({
      kind: 'no_break',
      since: args.since,
      personIds: tired.map((f) => f.personId),
      largestTeam: team !== null && count >= args.cohortMinimum ? { team, count } : null,
    });
  }

  const [last, now] = [args.months.at(-2), args.months.at(-1)];
  if (now !== undefined) {
    const missed = { thisMonth: now.missedClockOuts, lastMonth: last?.missedClockOuts ?? 0 };
    if (missed.thisMonth + missed.lastMonth > 0)
      points.push({ kind: 'missed_clock_outs', ...missed });
    const overtime = {
      thisMonthMinutes: now.overtimeMinutes,
      lastMonthMinutes: last?.overtimeMinutes ?? 0,
    };
    if (overtime.thisMonthMinutes + overtime.lastMonthMinutes > 0) {
      points.push({ kind: 'overtime', ...overtime });
    }
  }
  return points;
}

/** The groups large enough to describe, and how many were left out. */
export function describable<T extends { readonly people: number }>(
  groups: readonly T[],
  cohortMinimum: number,
): { shown: T[]; hidden: number } {
  const shown = groups.filter((g) => g.people >= cohortMinimum);
  return { shown, hidden: groups.length - shown.length };
}
