import { createHash } from 'node:crypto';
import { ok, type Result } from '@kithena/domain-kit';
import type { CalendarDate, DayAmount, PersonId, TeamKey, TenantId } from '@kithena/contracts';

import { AttendanceClock } from '../../domain/attendance/clock.js';
import { dayOf, type AttendanceRules } from '../../domain/attendance/day.js';
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
import type { Writer } from '../assist/ports.js';
import { written, type Line } from '../assist/written.js';
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
  const yes = await Promise.all(active.map((m) => relates(deps, caller, 'approver', m.personId)));
  const mine = active.filter((_, i) => yes[i]);
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

/**
 * A month's attendance counts for one member, kept once the month has ended.
 *
 * A sliding window: of the six months Insights shows, only the one still
 * running moves; an ended month is built again only when what it is built
 * from changes. For a day already over, \`dayOf\` depends on that day's
 * shifts, the schedule, the attendance rules and the zone, and on "now" only
 * as "the day is over", which an ended month always is. So the key is a hash
 * of exactly those for the month: a correction, a late punch, a new schedule
 * or new rules is a new key, and nothing stale is ever read.
 *
 * ponytail: per process, the oldest out past 20,000 member-months; a table
 * kept by the nightly job if there is ever more than one Time Off process.
 */
const endedMonths = new Map<string, { missedClockOuts: number; overtimeMinutes: number }>();
const KEEP_MONTHS = 20_000;

async function factsOf(
  tx: Tx,
  deps: Pick<Deps, 'clock'>,
  tenantId: Caller['tenantId'],
  m: Member,
  months: readonly string[],
  rules: AttendanceRules,
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
  const now = deps.clock.instant();
  // Only a day with a shift can be open or carry overtime; the rest count for
  // neither, so they are never built.
  const shiftDays = new Set(clock.shifts.map((s) => s.date));
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
    const count = (): { missedClockOuts: number; overtimeMinutes: number } => {
      const worked =
        last < from
          ? []
          : datesIn(from, last)
              .filter((date) => shiftDays.has(date))
              .map((date) =>
                dayOf({ date, schedule, shifts: clock.shifts, now, timeZone: m.timeZone, rules }),
              );
      return {
        missedClockOuts: worked.filter((w) => w.status === 'open').length,
        overtimeMinutes: worked.reduce(
          (n, w) => n + (w.status === 'complete' ? w.overtimeMinutes : 0),
          0,
        ),
      };
    };
    let attendance: { missedClockOuts: number; overtimeMinutes: number };
    if (to >= today) {
      attendance = count();
    } else {
      const key = createHash('sha256')
        .update(
          JSON.stringify([
            tenantId,
            m.personId,
            month,
            m.timeZone,
            schedule,
            rules,
            clock.shifts.filter((s) => s.date >= from && s.date <= to),
          ]),
        )
        .digest('hex');
      const held = endedMonths.get(key);
      if (held === undefined) {
        attendance = count();
        if (endedMonths.size >= KEEP_MONTHS)
          endedMonths.delete(endedMonths.keys().next().value ?? '');
        endedMonths.set(key, attendance);
      } else {
        attendance = held;
      }
    }
    byMonth.set(month, {
      vacation: taken((c) => c === 'annual_leave'),
      personal: taken((c) => c !== 'annual_leave' && c !== 'sick_leave'),
      sick: taken((c) => c === 'sick_leave'),
      ...attendance,
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
        // Every member's year at once; the rules are the company's, read once.
        const rules = await tx.attendance.rules();
        const years: MemberYear[] = await Promise.all(
          scope.members.map((m) => factsOf(tx, deps, caller.tenantId, m, months, rules)),
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
