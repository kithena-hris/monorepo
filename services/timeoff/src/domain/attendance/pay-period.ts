import { err, failure, ok, type Clock, type PendingEvent, type Result } from '@kithena/domain-kit';
import {
  DayAmount,
  HourAmount,
  PeriodClosed,
  type Actor,
  type CalendarDate,
  type Instant,
  type PersonId,
  type TeamKey,
  type TenantId,
} from '@kithena/contracts';

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
