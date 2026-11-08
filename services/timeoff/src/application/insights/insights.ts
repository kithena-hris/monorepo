import { ok, type Result } from '@kithena/domain-kit';
import type { CalendarDate, DayAmount, PersonId, TeamKey, TenantId } from '@kithena/contracts';

import { addDays, addMonths, amount, days, Decimal, sum } from '../../domain/days.js';
import {
  describable,
  whatChanged,
  type Facts,
  type Monthly,
  type Point,
} from '../../domain/insights/insights.js';
import type { Writer } from '../assist/ports.js';
import { written, type Line } from '../assist/written.js';
import { workedMonthsOf } from '../attendance/attendance.js';
import type { Caller, Deps, Member, RequestRecord, Tx } from '../ports.js';
import { forbidden, isHrAdmin, leaveYear, policyFrom, relatedIds, transact } from '../shared.js';

/**
 * Insights (PRD §14.2, T27): time off and attendance across the caller's
 * scope — the company for HR, their reports for a manager — as the month in
 * points, the months behind it, the teams large enough to describe, and the
 * people behind every point.
 *
 * Every number is the domain's (`domain/insights`). The sentence for each
 * point comes from an `InsightWriter`: `writeInsights`, the assistant's
 * `Writer` through `written()`, with `templatedInsight` wherever there is no
 * model or its line does not hold up. Health data never leaves here as
 * anything but a total for a group at or above the cohort minimum, and no
 * point carries any.
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

/** What a point says and where it came from; `ai` when a model wrote the sentence. */
export interface PointWords {
  readonly text: string;
  readonly ai: boolean;
  readonly sources: readonly string[];
}

/** One sentence per point, in the points' order. */
export type InsightWriter = (
  tenantId: TenantId,
  points: readonly PointFacts[],
) => Promise<readonly PointWords[]>;

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

/** The template: plain sentences from the domain's numbers, nothing guessed. */
export const templatedInsight = ({
  point,
  teamName,
}: PointFacts): { text: string; sources: string[] } => {
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

/** A point's figures as the model may see them: counts, months and hours, never a person. */
function modelFacts({ point, teamName }: PointFacts): Record<string, unknown> {
  switch (point.kind) {
    case 'unbooked':
      return {
        unbookedDays: days(point.days).toString(),
        peopleWhoWouldLoseSome: point.personIds.length,
      };
    case 'no_break':
      return {
        people: point.personIds.length,
        noDayOffSince: monthOf(point.since),
        // The team is a placeholder, filled in after the model answers.
        mostAreIn:
          point.largestTeam === null || teamName === null
            ? null
            : { team: '{team}', count: point.largestTeam.count },
      };
    case 'missed_clock_outs':
      return {
        missedClockOutsLastMonth: point.lastMonth,
        missedClockOutsThisMonth: point.thisMonth,
      };
    case 'overtime':
      return {
        overtimeThisMonth: hours(point.thisMonthMinutes),
        overtimeLastMonth: hours(point.lastMonthMinutes),
        change: change(point.thisMonthMinutes, point.lastMonthMinutes).trim() || null,
      };
  }
}

const ABOUT: Record<Point['kind'], string> = {
  unbooked: 'How much vacation is still unbooked, and how many would lose some at the year end.',
  no_break: 'How many have not taken a day off since the month given, and the team most are in.',
  missed_clock_outs: 'How missed clock-outs moved from last month to this one.',
  overtime: 'How much overtime there was this month, against last month.',
};

/**
 * The assistant's sentences for a month's points (TOF-097 on TOF-084), one
 * call for all of them, through `written()`: a line that is missing, too
 * long or carries a number the facts do not is the template instead. The
 * model sees each point's counts and nothing else: no person, no id, and the
 * team only as `{team}`.
 */
export const writeInsights =
  (writer: Writer | undefined): InsightWriter =>
  async (tenantId, points) => {
    const plain = points.map(templatedInsight);
    const lines = Object.fromEntries(
      points.map((p, i) => [
        `p${String(i)}`,
        { about: ABOUT[p.point.kind], template: plain[i]?.text ?? '' } satisfies Line,
      ]),
    );
    const team = points.find((p) => p.teamName !== null)?.teamName ?? null;
    const out = await written(
      writer,
      tenantId,
      {
        instruction:
          'HR or a manager is reading what changed this month in time off and attendance. ' +
          'Say each point in one plain sentence.',
        facts: Object.fromEntries(points.map((p, i) => [`p${String(i)}`, modelFacts(p)])),
      },
      lines,
      team === null ? {} : { team },
    );
    return points.map((_, i) => ({
      ...(out[`p${String(i)}`] ?? { text: plain[i]?.text ?? '', ai: false }),
      sources: plain[i]?.sources ?? [],
    }));
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
    /** A model wrote `text`; the screen tags it (PRD §14.1). */
    readonly ai: boolean;
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
  const approver = await relatedIds(deps, caller, 'approver');
  const mine = active.filter((m) => approver.has(m.personId));
  return mine.length === 0 ? null : { scope: 'team', members: mine };
}

interface MemberYear extends Facts {
  readonly member: Member;
  readonly byMonth: ReadonlyMap<string, Omit<Monthly, 'month'>>;
}

export interface AnnualFacts {
  readonly left: DayAmount;
  readonly losesAtYearEnd: DayAmount;
  readonly yearEnd: CalendarDate;
  readonly lastDayOff: CalendarDate | null;
  readonly requests: readonly RequestRecord[];
}

/**
 * Each member's annual leave this leave year: what is left, what the year
 * end would take above the carry-over, when it ends, their last day off up to
 * today, and the approved requests that say so.
 *
 * Read for all of them at once: the leave types, each annual type's policies
 * and ledger, and the requests, a handful of queries however many members,
 * where asking member by member was seven each.
 */
export async function annualFactsOf(
  tx: Tx,
  members: readonly Member[],
  todayOf: (m: Member) => CalendarDate,
): Promise<ReadonlyMap<PersonId, AnnualFacts>> {
  if (members.length === 0) return new Map();
  const ids = members.map((m) => m.personId);
  const annual = (await tx.leaveTypes.list()).filter(
    (t) => t.definition.category === 'annual_leave' && t.definition.tracked && !t.deleted,
  );
  const [policies, requests] = await Promise.all([
    Promise.all(annual.map((t) => tx.policies.forLeaveType(t.definition.key))),
    tx.requests.list({ personIds: ids, statuses: ['approved', 'taken'] }),
  ]);
  const requestsOf = new Map<string, RequestRecord[]>();
  for (const r of requests) {
    const held = requestsOf.get(r.request.personId) ?? [];
    held.push(r);
    requestsOf.set(r.request.personId, held);
  }
  // Each member's leave year of each annual type, and what is left at its end.
  const yearsOf = annual.map(
    (_, i) =>
      new Map(
        members.map((m) => {
          const policy = policyFrom(policies[i] ?? [], m, todayOf(m));
          return [m.personId, { policy, ...leaveYear(policy?.definition ?? null, todayOf(m)) }];
        }),
      ),
  );
  const lefts = await Promise.all(
    annual.map((t, i) =>
      tx.ledger.leftOn(
        t.definition.key,
        members.map((m) => {
          const year = yearsOf[i]?.get(m.personId);
          const { start, end } = year ?? leaveYear(null, todayOf(m));
          return { personId: m.personId, start, on: end };
        }),
      ),
    ),
  );

  return new Map(
    members.map((m): [PersonId, AnnualFacts] => {
      const today = todayOf(m);
      let left = new Decimal(0);
      let loses = new Decimal(0);
      let yearEnd = leaveYear(null, today).end;
      annual.forEach((_, i) => {
        const year = yearsOf[i]?.get(m.personId);
        const policy = year?.policy ?? null;
        yearEnd = year?.end ?? yearEnd;
        const mine = days(lefts[i]?.get(m.personId) ?? '0.000');
        left = left.plus(mine);
        const cap = policy?.definition.carryOver?.maxDays;
        loses = loses.plus(Decimal.max(0, cap === undefined ? mine : mine.minus(cap)));
      });
      const own = requestsOf.get(m.personId) ?? [];
      const lastDayOff =
        own
          .filter(
            (r) => r.request.leaveType.category === 'annual_leave' && r.request.span.from <= today,
          )
          .map((r) => (r.request.span.to < today ? r.request.span.to : today))
          .toSorted()
          .at(-1) ?? null;
      return [
        m.personId,
        { left: amount(left), losesAtYearEnd: amount(loses), yearEnd, lastDayOff, requests: own },
      ];
    }),
  );
}

/** A member's six months, from what was read for the whole company at once. */
function factsOf(
  m: Member,
  months: readonly string[],
  read: {
    readonly annual: AnnualFacts | undefined;
    /** Open days and overtime by `YYYY-MM`, summed where the days are kept. */
    readonly attendance: ReadonlyMap<string, { missedClockOuts: number; overtimeMinutes: number }>;
  },
): MemberYear {
  const { left, losesAtYearEnd, lastDayOff, requests } = read.annual ?? {
    left: amount('0'),
    losesAtYearEnd: amount('0'),
    lastDayOff: null,
    requests: [],
  };
  const byMonth = new Map<string, Omit<Monthly, 'month'>>();
  for (const month of months) {
    const from = `${month}-01` as CalendarDate;
    const to = addDays(addMonths(from, 1), -1);
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
    byMonth.set(month, {
      vacation: taken((c) => c === 'annual_leave'),
      personal: taken((c) => c !== 'annual_leave' && c !== 'sick_leave'),
      sick: taken((c) => c === 'sick_leave'),
      ...(read.attendance.get(month) ?? { missedClockOuts: 0, overtimeMinutes: 0 }),
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

/**
 * T27–T28's read: the month in points, its trends, the teams and the people
 * behind it. The sentences are written after the transaction, so a model's
 * latency never holds one open.
 */
export const insights =
  (
    deps: Pick<Deps, 'uow' | 'authz' | 'clock' | 'writer'>,
    writer: InsightWriter = writeInsights(deps.writer),
  ) =>
  async (caller: Caller): Promise<Result<InsightsView>> => {
    const read = await transact<{ view: InsightsView; facts: PointFacts[] }>(
      deps,
      caller.tenantId,
      async (tx) => {
        const scope = await scopeOf(tx, deps, caller);
        if (scope === null) return forbidden();
        const today = deps.clock.date('UTC');
        const first = `${today.slice(0, 7)}-01` as CalendarDate;
        const months = Array.from({ length: MONTHS }, (_, i) =>
          addMonths(first, i - MONTHS + 1).slice(0, 7),
        );
        const cohortMinimum =
          (await tx.settings.get('cohort_minimum'))?.value ?? DEFAULT_COHORT_MINIMUM;
        // What every member's year is built from, read for all of them at
        // once: a handful of queries, not several per member.
        const [annual, attendance] = await Promise.all([
          annualFactsOf(tx, scope.members, (m) => deps.clock.date(m.timeZone)),
          // The six months on show, to yesterday: each member's kept days, summed.
          workedMonthsOf(tx, deps, scope.members, addMonths(first, 1 - MONTHS), addDays(today, -1)),
        ]);
        const years: MemberYear[] = scope.members.map((m) =>
          factsOf(m, months, {
            annual: annual.get(m.personId),
            attendance: attendance.get(m.personId) ?? new Map(),
          }),
        );

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
        const facts: PointFacts[] = whatChanged({
          facts: years,
          months: monthly,
          since,
          cohortMinimum,
        }).map((point) => ({
          point,
          teamName:
            point.kind === 'no_break' && point.largestTeam !== null
              ? (teamNames.get(point.largestTeam.team) ?? null)
              : null,
        }));
        // The words are written once the transaction is over.
        const points = facts.map(({ point }) => ({
          kind: point.kind,
          figure:
            point.kind === 'unbooked'
              ? days(point.days).toString()
              : point.kind === 'no_break'
                ? String(point.personIds.length)
                : point.kind === 'missed_clock_outs'
                  ? String(point.thisMonth)
                  : hours(point.thisMonthMinutes),
          text: '',
          ai: false,
          sources: [],
          personIds: 'personIds' in point ? point.personIds : [],
        }));

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
          facts,
          view: {
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
          },
        });
      },
    );
    if (!read.ok) return read;
    const words = await writer(caller.tenantId, read.value.facts);
    const { view } = read.value;
    return ok({
      ...view,
      points: view.points.map((p, i) => ({ ...p, ...words[i] })),
    });
  };
