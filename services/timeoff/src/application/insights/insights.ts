import { ok, type Result } from '@kithena/domain-kit';
import type { CalendarDate, DayAmount, PersonId, TeamKey } from '@kithena/contracts';

import { AttendanceClock } from '../../domain/attendance/clock.js';
import { dayOf } from '../../domain/attendance/day.js';
import { balanceOn } from '../../domain/balance/ledger.js';
import { datesIn } from '../../domain/calendar/working-days.js';
import { addDays, addMonths, amount, days, Decimal, sum } from '../../domain/days.js';
import {
  describable,
  whatChanged,
  type Facts,
  type Monthly,
  type Point,
} from '../../domain/insights/insights.js';
import { DEFAULT_SCHEDULE } from '../attendance/attendance.js';
import type { Caller, Deps, Member, RequestRecord, Tx } from '../ports.js';
import { forbidden, isHrAdmin, leaveYear, policyFor, relates, transact } from '../shared.js';

/**
 * Insights (PRD §14.2, T27): time off and attendance across the caller's
 * scope — the company for HR, their reports for a manager — as the month in
 * points, the months behind it, the teams large enough to describe, and the
 * people behind every point.
 *
 * Every number is the domain's (`domain/insights`). The sentence for each
 * point comes from an `InsightWriter`; until the assistant's writer lands
 * (TOF-084) it is `templatedInsight`, which is also what that writer falls
 * back to without a key. Health data never leaves here as anything but a
 * total for a group at or above the cohort minimum.
 */

/** The cohort minimum when People has not said one: its own floor. */
export const DEFAULT_COHORT_MINIMUM = 10;

/** How many months the trends go back, this one included. */
const MONTHS = 6;

/** What the writer is told about a point: its numbers, and the team it may name. */
export interface PointFacts {
  readonly point: Point;
  readonly teamName: string | null;
}

/** One sentence per point and the chips that say where it came from. */
export type InsightWriter = (facts: PointFacts) => { text: string; sources: string[] };

const people = (n: number): string => (n === 1 ? '1 person' : `${String(n)} people`);
const hours = (minutes: number): string => `${String(Math.round(minutes / 60))}h`;
const monthOf = (date: CalendarDate): string =>
  new Intl.DateTimeFormat('en-GB', { month: 'long', timeZone: 'UTC' }).format(
    new Date(`${date}T00:00:00Z`),
  );
const change = (now: number, before: number): string =>
  before === 0
    ? ''
    : ` (${now >= before ? 'up' : 'down'} ${String(Math.round((Math.abs(now - before) / before) * 100))}%)`;

/** The templated writer: plain sentences from the domain's numbers, nothing guessed. */
export const templatedInsight: InsightWriter = ({ point, teamName }) => {
  switch (point.kind) {
    case 'unbooked':
      return {
        text: `${days(point.days).toString()} days of vacation are still unbooked this year.${
          point.personIds.length === 0
            ? ''
            : ` At this pace ${people(point.personIds.length)} will lose some at the year end.`
        }`,
        sources: ['Balances', 'Carry-over'],
      };
    case 'no_break':
      return {
        text: `${people(point.personIds.length)} ${point.personIds.length === 1 ? 'hasn’t' : 'haven’t'} taken a day off since ${monthOf(point.since)}.${
          point.largestTeam === null || teamName === null
            ? ''
            : ` ${String(point.largestTeam.count)} of them are in ${teamName}.`
        }`,
        sources: ['Time off'],
      };
    case 'missed_clock_outs':
      return {
        text: `Missed clock-outs went from ${String(point.lastMonth)} last month to ${String(point.thisMonth)} this month.`,
        sources: ['Attendance'],
      };
    case 'overtime':
      return {
        text: `Overtime came to ${hours(point.thisMonthMinutes)} this month${change(point.thisMonthMinutes, point.lastMonthMinutes)}.`,
        sources: ['Attendance'],
      };
  }
};

export interface InsightsView {
  readonly asOf: CalendarDate;
  readonly scope: 'company' | 'team';
  readonly cohortMinimum: number;
  readonly points: readonly {
    readonly kind: Point['kind'];
    /** The headline figure, as the domain counted it. */
    readonly figure: string;
    readonly text: string;
    readonly sources: readonly string[];
    readonly personIds: readonly PersonId[];
  }[];
  /** Oldest first; `sick` is `null` when the scope is smaller than the cohort minimum. */
  readonly months: readonly (Omit<Monthly, 'sick'> & { readonly sick: DayAmount | null })[];
  readonly teams: readonly {
    readonly team: TeamKey;
    readonly teamName: string | null;
    readonly people: number;
    readonly daysTaken: DayAmount;
    readonly overtimeMinutes: number;
    readonly left: DayAmount;
  }[];
  /** Teams left out for being smaller than the cohort minimum. */
  readonly hiddenTeams: number;
  readonly people: readonly {
    readonly personId: PersonId;
    readonly displayName: string;
    readonly teamName: string | null;
    readonly left: DayAmount;
    readonly losesAtYearEnd: DayAmount;
    readonly lastDayOff: CalendarDate | null;
  }[];
}

/** HR sees the company; an approver their reports; anybody else nothing. */
export async function scopeOf(
  tx: Tx,
  deps: Pick<Deps, 'authz'>,
  caller: Caller,
): Promise<{ scope: 'company' | 'team'; members: Member[] } | null> {
  const active = (await tx.members.list()).filter((m) => m.status !== 'left');
  if (await isHrAdmin(deps, caller)) return { scope: 'company', members: active };
  const mine: Member[] = [];
  for (const m of active) if (await relates(deps, caller, 'approver', m.personId)) mine.push(m);
  return mine.length === 0 ? null : { scope: 'team', members: mine };
}

interface MemberYear extends Facts {
  readonly member: Member;
  readonly byMonth: ReadonlyMap<string, Omit<Monthly, 'month'>>;
}

/**
 * A member's annual leave this leave year: what is left, what the year end
 * would take above the carry-over, when it ends, their last day off up to
 * today, and the approved requests that say so.
 */
export async function annualFacts(
  tx: Tx,
  m: Member,
  today: CalendarDate,
): Promise<{
  left: DayAmount;
  losesAtYearEnd: DayAmount;
  yearEnd: CalendarDate;
  lastDayOff: CalendarDate | null;
  requests: readonly RequestRecord[];
}> {
  const annual = (await tx.leaveTypes.list()).filter(
    (t) => t.definition.category === 'annual_leave' && t.definition.tracked && !t.deleted,
  );
  let left = new Decimal(0);
  let loses = new Decimal(0);
  let yearEnd = leaveYear(null, today).end;
  for (const t of annual) {
    const policy = await policyFor(tx, m, t.definition.key, today);
    const { start, end } = leaveYear(policy?.definition ?? null, today);
    yearEnd = end;
    const entries = (await tx.ledger.forMember(m.personId, t.definition.key)).filter(
      (e) => e.effectiveOn >= start && e.effectiveOn <= end,
    );
    const mine = days(balanceOn(entries, end).left);
    left = left.plus(mine);
    const cap = policy?.definition.carryOver?.maxDays;
    loses = loses.plus(Decimal.max(0, cap === undefined ? mine : mine.minus(cap)));
  }

  const requests = await tx.requests.list({
    personIds: [m.personId],
    statuses: ['approved', 'taken'],
  });
  const lastDayOff =
    requests
      .filter(
        (r) => r.request.leaveType.category === 'annual_leave' && r.request.span.from <= today,
      )
      .map((r) => (r.request.span.to < today ? r.request.span.to : today))
      .toSorted()
      .at(-1) ?? null;
  return { left: amount(left), losesAtYearEnd: amount(loses), yearEnd, lastDayOff, requests };
}

async function factsOf(
  tx: Tx,
  deps: Pick<Deps, 'clock'>,
  tenantId: Caller['tenantId'],
  m: Member,
  months: readonly string[],
): Promise<MemberYear> {
  const today = deps.clock.date(m.timeZone);
  const { left, losesAtYearEnd, lastDayOff, requests } = await annualFacts(tx, m, today);
  const clock = AttendanceClock.of({
    tenantId,
    personId: m.personId,
    timeZone: m.timeZone,
    punches: await tx.attendance.punches(m.personId),
  });
  const schedule = (await tx.attendance.schedule(m.personId)) ?? DEFAULT_SCHEDULE;
  const rules = await tx.attendance.rules();
  const now = deps.clock.instant();
  const byMonth = new Map<string, Omit<Monthly, 'month'>>();
  for (const month of months) {
    const from = `${month}-01` as CalendarDate;
    const to = addDays(addMonths(from, 1), -1);
    const last = to < today ? to : addDays(today, -1);
    const taken = (category: (c: string) => boolean) =>
      amount(
        sum(
          requests
            .filter(
              (r) =>
                category(r.request.leaveType.category) &&
                r.request.span.from >= from &&
                r.request.span.from <= to,
            )
            .map((r) => days(r.request.span.workingDays)),
        ),
      );
    // ponytail: a day at a time over six months per member; a summary table
    // kept by the nightly job is the upgrade when a tenant outgrows it.
    const worked =
      last < from
        ? []
        : datesIn(from, last).map((date) =>
            dayOf({ date, schedule, shifts: clock.shifts, now, timeZone: m.timeZone, rules }),
          );
    byMonth.set(month, {
      vacation: taken((c) => c === 'annual_leave'),
      personal: taken((c) => c !== 'annual_leave' && c !== 'sick_leave'),
      sick: taken((c) => c === 'sick_leave'),
      missedClockOuts: worked.filter((w) => w.status === 'open').length,
      overtimeMinutes: worked.reduce(
        (n, w) => n + (w.status === 'complete' ? w.overtimeMinutes : 0),
        0,
      ),
    });
  }
  return {
    member: m,
    personId: m.personId,
    team: m.teamKey,
    hireDate: m.hireDate,
    lastDayOff,
    left,
    losesAtYearEnd,
    byMonth,
  };
}

/** T27–T28's read: the month in points, its trends, the teams and the people behind it. */
export const insights =
  (deps: Pick<Deps, 'uow' | 'authz' | 'clock'>, writer: InsightWriter = templatedInsight) =>
  (caller: Caller): Promise<Result<InsightsView>> =>
    transact<InsightsView>(deps, caller.tenantId, async (tx) => {
      const scope = await scopeOf(tx, deps, caller);
      if (scope === null) return forbidden();
      const today = deps.clock.date('UTC');
      const first = `${today.slice(0, 7)}-01` as CalendarDate;
      const months = Array.from({ length: MONTHS }, (_, i) =>
        addMonths(first, i - MONTHS + 1).slice(0, 7),
      );
      const cohortMinimum =
        (await tx.settings.get('cohort_minimum'))?.value ?? DEFAULT_COHORT_MINIMUM;
      const years: MemberYear[] = [];
      for (const m of scope.members)
        years.push(await factsOf(tx, deps, caller.tenantId, m, months));

      const monthly: Monthly[] = months.map((month) => {
        const all = years.map((y) => y.byMonth.get(month));
        const dayTotal = (f: (x: Omit<Monthly, 'month'>) => DayAmount) =>
          amount(sum(all.flatMap((x) => (x === undefined ? [] : [days(f(x))]))));
        return {
          month,
          vacation: dayTotal((x) => x.vacation),
          personal: dayTotal((x) => x.personal),
          sick: dayTotal((x) => x.sick),
          missedClockOuts: all.reduce((n, x) => n + (x?.missedClockOuts ?? 0), 0),
          overtimeMinutes: all.reduce((n, x) => n + (x?.overtimeMinutes ?? 0), 0),
        };
      });
      // Four months back from the start of this one: "since May" on 1 October.
      const since = addMonths(first, -4);
      const teamNames = new Map(years.map((y) => [y.team, y.member.teamName]));
      const points = whatChanged({ facts: years, months: monthly, since, cohortMinimum }).map(
        (point) => {
          const { text, sources } = writer({
            point,
            teamName:
              point.kind === 'no_break' && point.largestTeam !== null
                ? (teamNames.get(point.largestTeam.team) ?? null)
                : null,
          });
          return {
            kind: point.kind,
            figure:
              point.kind === 'unbooked'
                ? days(point.days).toString()
                : point.kind === 'no_break'
                  ? String(point.personIds.length)
                  : point.kind === 'missed_clock_outs'
                    ? String(point.thisMonth)
                    : hours(point.thisMonthMinutes),
            text,
            sources,
            personIds: 'personIds' in point ? point.personIds : [],
          };
        },
      );

      const groups = new Map<TeamKey, MemberYear[]>();
      for (const y of years) {
        if (y.team !== null) groups.set(y.team, [...(groups.get(y.team) ?? []), y]);
      }
      const { shown, hidden } = describable(
        [...groups].map(([team, ys]) => ({
          team,
          teamName: ys[0]?.member.teamName ?? null,
          people: ys.length,
          daysTaken: amount(
            sum(
              ys.flatMap((y) =>
                [...y.byMonth.values()].map((x) => days(x.vacation).plus(x.personal)),
              ),
            ),
          ),
          overtimeMinutes: ys.reduce(
            (n, y) => n + [...y.byMonth.values()].reduce((k, x) => k + x.overtimeMinutes, 0),
            0,
          ),
          left: amount(sum(ys.map((y) => days(y.left)))),
        })),
        cohortMinimum,
      );
      const small = scope.members.length < cohortMinimum;
      return ok({
        asOf: today,
        scope: scope.scope,
        cohortMinimum,
        points,
        months: monthly.map((x) => ({ ...x, sick: small ? null : x.sick })),
        teams: shown.toSorted((a, b) => a.team.localeCompare(b.team)),
        hiddenTeams: hidden,
        people: years
          .map((y) => ({
            personId: y.personId,
            displayName: y.member.displayName,
            teamName: y.member.teamName,
            left: y.left,
            losesAtYearEnd: y.losesAtYearEnd,
            lastDayOff: y.lastDayOff,
          }))
          .toSorted((a, b) => a.displayName.localeCompare(b.displayName)),
      });
    });
