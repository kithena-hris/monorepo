import { err, failure, ok, type Clock, type PendingEvent, type Result } from '@kithena/domain-kit';
import {
  DayAmount,
  HourAmount,
  PeriodClosed,
  type Actor,
  type CalendarDate,
  type Instant,
  type Money,
  type PersonId,
  type TeamKey,
  type TenantId,
} from '@kithena/contracts';

import { amount, Decimal, sum } from '../days.js';

/**
 * The pay period: a month of attendance, closed and sent to Payroll (PRD
 * §11.8, T24).
 *
 * Time reaches a period as lines, one per member per day, each posted to a
 * period when it is written. **A closed period is locked**: a later
 * correction dated inside it is posted to the next open one, carrying
 * `supersedes`, so what Payroll was sent stays what it was sent and the
 * difference arrives the month after.
 */

export interface PayPeriod {
  readonly id: string;
  readonly from: CalendarDate;
  readonly to: CalendarDate;
  readonly closedAt: Instant | null;
}

/** A member's day as Payroll counts it. Corrections are new lines, never edits. */
export interface TimeLine {
  readonly id: string;
  readonly personId: PersonId;
  readonly team: TeamKey;
  /** The day it is about. */
  readonly date: CalendarDate;
  /** Where it counts: the date's own period, or the next open one if that was closed. */
  readonly periodId: string;
  readonly workedMinutes: number;
  /** Overtime banked as comp time. */
  readonly compMinutes: number;
  /** Overtime paid. */
  readonly paidMinutes: number;
  /** The line this one replaces; its period counts the difference. */
  readonly supersedes: string | null;
}

type Minutes = Pick<TimeLine, 'workedMinutes' | 'compMinutes' | 'paidMinutes'>;

/** Post a line to the period it belongs in, or the next open one. */
export function post(
  periods: readonly PayPeriod[],
  lines: readonly TimeLine[],
  line: Omit<TimeLine, 'periodId'>,
): Result<TimeLine> {
  if (line.supersedes !== null && !lines.some((l) => l.id === line.supersedes)) {
    return err(failure('SUPERSEDES_UNKNOWN', `No line called ${line.supersedes}`, ['supersedes']));
  }
  const target = inOrder(periods).find((p) => p.to >= line.date && p.closedAt === null);
  if (!target) {
    return err(failure('NO_OPEN_PERIOD', `No open pay period on or after ${line.date}`, ['date']));
  }
  return ok({ ...line, periodId: target.id });
}

export interface MemberTotal extends Minutes {
  readonly personId: PersonId;
  readonly team: TeamKey;
}
export interface TeamTotal extends Minutes {
  readonly team: TeamKey;
  readonly people: number;
}

/**
 * What a period counts, per member and per team: every line posted to it,
 * less whatever each one superseded.
 */
export function totals(
  period: PayPeriod,
  lines: readonly TimeLine[],
): { members: MemberTotal[]; teams: TeamTotal[] } {
  const byId = new Map(lines.map((l) => [l.id, l]));
  const members = new Map<string, MemberTotal>();
  for (const l of lines.filter((x) => x.periodId === period.id)) {
    const was = l.supersedes === null ? undefined : byId.get(l.supersedes);
    const key = `${l.personId} ${l.team}`;
    const m = members.get(key) ?? {
      personId: l.personId,
      team: l.team,
      workedMinutes: 0,
      compMinutes: 0,
      paidMinutes: 0,
    };
    members.set(key, {
      ...m,
      workedMinutes: m.workedMinutes + l.workedMinutes - (was?.workedMinutes ?? 0),
      compMinutes: m.compMinutes + l.compMinutes - (was?.compMinutes ?? 0),
      paidMinutes: m.paidMinutes + l.paidMinutes - (was?.paidMinutes ?? 0),
    });
  }

  const teams = new Map<string, TeamTotal>();
  for (const m of members.values()) {
    const t = teams.get(m.team) ?? {
      team: m.team,
      people: 0,
      workedMinutes: 0,
      compMinutes: 0,
      paidMinutes: 0,
    };
    teams.set(m.team, {
      team: m.team,
      people: t.people + 1,
      workedMinutes: t.workedMinutes + m.workedMinutes,
      compMinutes: t.compMinutes + m.compMinutes,
      paidMinutes: t.paidMinutes + m.paidMinutes,
    });
  }
  return { members: [...members.values()], teams: [...teams.values()] };
}

/**
 * "Send September to Payroll": lock the period and publish
 * `timeoff.period.closed` with hours and days, **never punch times or
 * locations**. Periods close in order, so "the next open one" is always later.
 */
export function close(args: {
  periods: readonly PayPeriod[];
  periodId: string;
  lines: readonly TimeLine[];
  /** From the ledger (TOF-014). A member missing here had neither. */
  balances: ReadonlyMap<PersonId, { unpaidDays: DayAmount; negativeBalanceDays: DayAmount }>;
  /** Hourly rates, where known; a member missing here is sent hours only. */
  rates?: ReadonlyMap<PersonId, Money>;
  /** Paid overtime's multiplier (T33), as a decimal string. */
  multiplier?: string;
  /** UUIDv7, minted by the application. */
  eventId: string;
  tenantId: TenantId;
  actor: Actor;
  correlationId: string;
  clock: Clock;
}): Result<{ periods: PayPeriod[]; event: PendingEvent }> {
  const period = args.periods.find((p) => p.id === args.periodId);
  if (!period) return err(failure('NOT_FOUND', 'Pay period not found'));
  if (period.closedAt !== null)
    return err(failure('ALREADY_CLOSED', `${period.from} to ${period.to} is already closed`));
  if (args.periods.some((p) => p.to < period.from && p.closedAt === null)) {
    return err(failure('EARLIER_PERIOD_OPEN', 'Close the earlier pay period first'));
  }

  const now = args.clock.instant();
  const zero = DayAmount.parse('0.000');
  const members = totals(period, args.lines).members.map((m) => ({
    personId: m.personId,
    workedHours: hours(m.workedMinutes),
    overtimeHours: hours(m.paidMinutes),
    compHours: hours(m.compMinutes),
    unpaidDays: args.balances.get(m.personId)?.unpaidDays ?? zero,
    negativeBalanceDays: args.balances.get(m.personId)?.negativeBalanceDays ?? zero,
    overtimeAmount: priced(m.paidMinutes, args.rates?.get(m.personId), args.multiplier ?? '1'),
  }));

  return ok({
    periods: args.periods.map((p) => (p.id === period.id ? { ...p, closedAt: now } : p)),
    event: {
      eventId: args.eventId,
      eventName: PeriodClosed.name,
      eventVersion: PeriodClosed.version,
      tenantId: args.tenantId,
      occurredAt: now,
      effectiveFrom: period.from,
      aggregate: { type: 'PayPeriod', id: period.id, version: 1 },
      actor: args.actor,
      correlationId: args.correlationId,
      causationId: null,
      payload: { periodId: period.id, from: period.from, to: period.to, members },
    },
  });
}

/** Paid overtime at the multiplier, rounded half up to the minor unit; `null` without a rate. */
function priced(minutes: number, rate: Money | undefined, multiplier: string): Money | null {
  if (rate === undefined) return null;
  const amountMinor = new Decimal(minutes)
    .div(60)
    .times(multiplier)
    .times(rate.amountMinor)
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
    .toNumber();
  return { amountMinor, currency: rate.currency };
}

/** One member's month as T24 counts it, before anything is sent. */
export interface MemberMonth {
  readonly personId: PersonId;
  readonly team: TeamKey;
  readonly teamName: string | null;
  /** Days without a clock-out. */
  readonly openDays: number;
  /** Overtime nobody has decided. */
  readonly overtimeWaitingMinutes: number;
  readonly paidMinutes: number;
  readonly compMinutes: number;
  readonly unpaidDays: DayAmount;
  readonly negativeBalanceDays: DayAmount;
}

export interface TeamMonth {
  readonly team: TeamKey;
  readonly teamName: string | null;
  readonly people: number;
  /** People with a day to fix or overtime to decide: late for Payroll. */
  readonly waiting: number;
  readonly paidMinutes: number;
  readonly compMinutes: number;
  /** How the team's decided overtime goes to Payroll; `null` with none. */
  readonly paidAs: 'comp' | 'paid' | 'mixed' | null;
}

/**
 * T24, §11.8: the month per team and in total — overtime paid and banked,
 * unpaid leave and negative balances — and who is late. Teams in key order.
 */
export function monthSummary(members: readonly MemberMonth[]): {
  teams: TeamMonth[];
  totals: {
    paidMinutes: number;
    compMinutes: number;
    unpaidDays: DayAmount;
    unpaidPeople: number;
    negativePeople: number;
    negativeBalanceDays: DayAmount;
  };
} {
  const teams = new Map<string, MemberMonth[]>();
  for (const m of members) teams.set(m.team, [...(teams.get(m.team) ?? []), m]);
  const add = (ms: readonly MemberMonth[], f: (m: MemberMonth) => number) =>
    ms.reduce((n, m) => n + f(m), 0);
  const sumDays = (ms: readonly MemberMonth[], f: (m: MemberMonth) => DayAmount) =>
    amount(sum(ms.map(f)));
  return {
    teams: [...teams.entries()]
      .toSorted(([a], [b]) => a.localeCompare(b))
      .map(([team, ms]) => {
        const paidMinutes = add(ms, (m) => m.paidMinutes);
        const compMinutes = add(ms, (m) => m.compMinutes);
        return {
          team: team as TeamKey,
          teamName: ms[0]?.teamName ?? null,
          people: ms.length,
          waiting: ms.filter((m) => m.openDays > 0 || m.overtimeWaitingMinutes > 0).length,
          paidMinutes,
          compMinutes,
          paidAs:
            paidMinutes > 0 && compMinutes > 0
              ? 'mixed'
              : paidMinutes > 0
                ? 'paid'
                : compMinutes > 0
                  ? 'comp'
                  : null,
        };
      }),
    totals: {
      paidMinutes: add(members, (m) => m.paidMinutes),
      compMinutes: add(members, (m) => m.compMinutes),
      unpaidDays: sumDays(members, (m) => m.unpaidDays),
      unpaidPeople: members.filter((m) => new Decimal(m.unpaidDays).gt(0)).length,
      negativePeople: members.filter((m) => new Decimal(m.negativeBalanceDays).gt(0)).length,
      negativeBalanceDays: sumDays(members, (m) => m.negativeBalanceDays),
    },
  };
}

/**
 * Minutes as an `HourAmount`, rounded half up to three places, in integers:
 * a minute is 50/3 thousandths of an hour, which no float holds exactly.
 */
export function hours(minutes: number): HourAmount {
  const n = Math.abs(minutes) * 50;
  const thousandths = Math.floor(n / 3) + (n % 3 === 2 ? 1 : 0);
  const sign = minutes < 0 && thousandths > 0 ? '-' : '';
  return HourAmount.parse(
    `${sign}${String(Math.floor(thousandths / 1000))}.${String(thousandths % 1000).padStart(3, '0')}`,
  );
}

const inOrder = (periods: readonly PayPeriod[]) =>
  periods.toSorted((a, b) => a.from.localeCompare(b.from));
