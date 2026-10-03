import { err, Conflict, ok, type Result } from '@kithena/domain-kit';
import {
  CalendarDate,
  TeamKey,
  type AttendanceWorkModel,
  type ClockState,
  type DayAmount,
  type Instant,
  type PersonId,
  type PunchInput,
  type PunchKind,
} from '@kithena/contracts';

import { AttendanceClock, standing, type Punch } from '../../domain/attendance/clock.js';
import { needsManager, openDays } from '../../domain/attendance/correction.js';
import {
  dayOf,
  overtimeBecomes,
  restBreaches,
  weekOf,
  type Day,
  type WeekTotal,
} from '../../domain/attendance/day.js';
import {
  dailyRecord,
  exceptionsOf,
  type DailyRecord,
  type Exception,
} from '../../domain/attendance/exceptions.js';
import { close, hours, post as postLine } from '../../domain/attendance/pay-period.js';
import { resolveHolidays } from '../../domain/calendar/holiday-calendar.js';
import { hm, weekdays, type Schedule } from '../../domain/attendance/schedule.js';
import { entry } from '../../domain/balance/ledger.js';
import { datesIn, weekday } from '../../domain/calendar/working-days.js';
import { addDays, addMonths, amount, days as dayCount, sum } from '../../domain/days.js';
import {
  contextFor,
  userActor,
  type Caller,
  type Deps,
  type Member,
  type OvertimeDecision,
  type Tx,
} from '../ports.js';
import {
  balanceFor,
  forbidden,
  isHrAdmin,
  notFound,
  post,
  refuse,
  relates,
  transact,
} from '../shared.js';

/**
 * The clock and the timesheet (PRD §11, TOF-042): punch, break, clock out
 * and correct; my timesheet by week or month; team right now for a manager;
 * overtime approval.
 *
 * **Only the punches people make are recorded** — no location, no activity.
 * A correction is a new punch carrying `supersedes`, never an edit, and one
 * made more than a day after the fact goes in front of the manager.
 */

/** The tenant's usual day when a member has no schedule of their own: 09:00–17:30, half an hour's break. */
export const DEFAULT_SCHEDULE: Schedule = {
  kind: 'fixed',
  name: 'Standard',
  week: weekdays({ start: hm('09:00'), end: hm('17:30'), breakMinutes: 30 }),
};

/** A team key for Payroll's lines when the member is in none. */
const NO_TEAM = TeamKey.parse('unassigned');

async function memberOf(tx: Tx, caller: Caller): Promise<Result<Member>> {
  if (caller.personId === null) return forbidden();
  const member = await tx.members.get(caller.personId);
  return member === null ? notFound('Member') : ok(member);
}

/** The member, when the caller is them, approves or covers for them, or is HR. */
async function watched(
  tx: Tx,
  deps: Pick<Deps, 'authz'>,
  caller: Caller,
  personId: PersonId,
): Promise<Result<Member>> {
  const allowed =
    caller.personId === personId ||
    (await relates(deps, caller, 'approver', personId)) ||
    (await relates(deps, caller, 'delegate', personId)) ||
    (await isHrAdmin(deps, caller));
  if (!allowed) return forbidden();
  const member = await tx.members.get(personId);
  return member === null ? notFound('Member') : ok(member);
}

async function clockOf(
  tx: Tx,
  member: Member,
  tenantId: Caller['tenantId'],
): Promise<AttendanceClock> {
  return AttendanceClock.of({
    tenantId,
    personId: member.personId,
    timeZone: member.timeZone,
    punches: await tx.attendance.punches(member.personId),
  });
}

/**
 * A punch made afterwards through `correct`: its instant is not when it was
 * recorded, and no kiosk replayed it. A web or phone punch is recorded at the
 * instant it claims; a kiosk replaying a night offline names its device.
 */
const isCorrection = (p: Punch): boolean => p.deviceId === null && p.at !== p.recordedAt;

const scheduleOf = async (tx: Tx, member: Member): Promise<Schedule> =>
  (await tx.attendance.schedule(member.personId)) ?? DEFAULT_SCHEDULE;

/** Clock in, start or end a break, clock out, from whichever source (§11.1). */
export const punch =
  (deps: Pick<Deps, 'uow' | 'clock' | 'newId'>) =>
  (caller: Caller, input: PunchInput): Promise<Result<{ punch: Punch; state: ClockState }>> =>
    transact(deps, caller.tenantId, async (tx) => {
      const member = await memberOf(tx, caller);
      if (!member.ok) return member;
      const clock = await clockOf(tx, member.value, caller.tenantId);
      const punched = clock.punch({
        id: deps.newId(),
        input,
        actor: userActor(caller),
        correlationId: caller.correlationId,
        clock: deps.clock,
      });
      if (!punched.ok) return punched;
      await tx.attendance.appendPunch(member.value.personId, punched.value);
      await tx.outbox.publish(clock.drainEvents());
      return ok({ punch: punched.value, state: clock.state });
    });

/**
 * A punch made afterwards (§11.4): replacing one, or one that was never made
 * (`supersedes: null`, the forgotten clock-out). The member's own, or HR's.
 */
export const correctPunch =
  (deps: Pick<Deps, 'uow' | 'authz' | 'clock' | 'newId'>) =>
  (
    caller: Caller,
    input: {
      readonly personId: PersonId;
      readonly supersedes: string | null;
      readonly at: Instant;
      readonly kind: PunchKind;
      readonly workModel?: AttendanceWorkModel;
      readonly reason: string | null;
    },
  ): Promise<Result<{ punch: Punch; needsManager: boolean }>> =>
    transact(deps, caller.tenantId, async (tx) => {
      if (caller.personId !== input.personId && !(await isHrAdmin(deps, caller)))
        return forbidden();
      const member = await tx.members.get(input.personId);
      if (member === null) return notFound('Member');
      const clock = await clockOf(tx, member, caller.tenantId);
      const replaced = clock.punches.find((p) => p.id === input.supersedes);
      const corrected = clock.correct({
        id: deps.newId(),
        supersedes: input.supersedes,
        at: input.at,
        kind: input.kind,
        source: 'web',
        workModel:
          input.workModel ??
          replaced?.workModel ??
          standing(clock.punches).at(-1)?.workModel ??
          'office',
        reason: input.reason,
        actor: userActor(caller),
        correlationId: caller.correlationId,
        clock: deps.clock,
      });
      if (!corrected.ok) return corrected;
      await tx.attendance.appendPunch(member.personId, corrected.value);
      await tx.outbox.publish(clock.drainEvents());
      return ok({
        punch: corrected.value,
        needsManager: needsManager(corrected.value, clock.punches),
      });
    });

export interface Timesheet {
  readonly days: readonly Day[];
  /** One per week touched, from its Monday. */
  readonly weeks: readonly (WeekTotal & { readonly monday: CalendarDate })[];
  /** Days without a clock-out, waiting for one (§11.4). */
  readonly open: readonly { readonly date: CalendarDate; readonly lastPunchAt: Instant }[];
  readonly restBreaches: readonly { readonly date: CalendarDate; readonly restMinutes: number }[];
  readonly overtime: readonly OvertimeDecision[];
  /** Corrections, with whether each is shown to the manager beside the original. */
  readonly corrections: readonly { readonly punch: Punch; readonly needsManager: boolean }[];
}

/** A timesheet by week or month (T20): the member's own, their approver's view, or HR's. */
export const timesheet =
  (deps: Pick<Deps, 'uow' | 'authz' | 'clock'>) =>
  (
    caller: Caller,
    input: { readonly personId: PersonId; readonly from: CalendarDate; readonly to: CalendarDate },
  ): Promise<Result<Timesheet>> =>
    transact(deps, caller.tenantId, async (tx) => {
      if (input.to < input.from)
        return refuse('INVALID_PERIOD', 'The range ends before it starts', ['to']);
      const member = await watched(tx, deps, caller, input.personId);
      if (!member.ok) return member;
      const clock = await clockOf(tx, member.value, caller.tenantId);
      const schedule = await scheduleOf(tx, member.value);
      const rules = await tx.attendance.rules();
      const now = deps.clock.instant();
      const { timeZone } = member.value;
      const days = datesIn(input.from, input.to).map((date) =>
        dayOf({ date, schedule, shifts: clock.shifts, now, timeZone, rules }),
      );
      const mondays = [...new Set(days.map((d) => addDays(d.date, 1 - weekday(d.date))))];
      const inRange = (date: CalendarDate) => date >= input.from && date <= input.to;
      return ok({
        days,
        weeks: mondays.map((monday) => ({
          monday,
          ...weekOf(
            days.filter((d) => addDays(d.date, 1 - weekday(d.date)) === monday),
            rules,
          ),
        })),
        open: openDays({ shifts: clock.shifts, schedule, now, timeZone }).filter((o) =>
          inRange(o.date),
        ),
        restBreaches: restBreaches(clock.shifts, rules).filter((r) => inRange(r.date)),
        overtime: (await tx.attendance.overtime(member.value.personId)).filter((o) =>
          inRange(o.date),
        ),
        corrections: clock.punches
          .filter(isCorrection)
          .map((p) => ({ punch: p, needsManager: needsManager(p, clock.punches) })),
      });
    });

export interface RightNow {
  readonly people: readonly {
    readonly personId: PersonId;
    readonly displayName: string;
    readonly state: ClockState;
    readonly workModel: AttendanceWorkModel | null;
    readonly today: Day;
  }[];
  /** "Needs you": corrections shown late, and overtime waiting for a decision. */
  readonly needsYou: readonly (
    | { readonly kind: 'correction'; readonly personId: PersonId; readonly punch: Punch }
    | {
        readonly kind: 'overtime';
        readonly personId: PersonId;
        readonly date: CalendarDate;
        readonly minutes: number;
      }
  )[];
}

/** How far back "needs you" looks. */
const NEEDS_YOU_DAYS = 31;

/** A calm live board of the caller's reports (§11.6): no trail, only the punches. */
export const teamRightNow =
  (deps: Pick<Deps, 'uow' | 'authz' | 'clock'>) =>
  (caller: Caller): Promise<Result<RightNow>> =>
    transact(deps, caller.tenantId, async (tx) => {
      const mine: Member[] = [];
      for (const m of await tx.members.list()) {
        if (m.status !== 'left' && (await relates(deps, caller, 'approver', m.personId)))
          mine.push(m);
      }
      const rules = await tx.attendance.rules();
      const now = deps.clock.instant();
      const people: RightNow['people'][number][] = [];
      const needsYou: RightNow['needsYou'][number][] = [];
      for (const m of mine) {
        const clock = await clockOf(tx, m, caller.tenantId);
        const schedule = await scheduleOf(tx, m);
        const today = deps.clock.date(m.timeZone);
        const day = (date: CalendarDate) =>
          dayOf({ date, schedule, shifts: clock.shifts, now, timeZone: m.timeZone, rules });
        people.push({
          personId: m.personId,
          displayName: m.displayName,
          state: clock.state,
          workModel: standing(clock.punches).at(-1)?.workModel ?? null,
          today: day(today),
        });
        const since = addDays(today, -NEEDS_YOU_DAYS);
        for (const p of clock.punches) {
          if (
            isCorrection(p) &&
            p.recordedAt.slice(0, 10) >= since &&
            needsManager(p, clock.punches)
          ) {
            needsYou.push({ kind: 'correction', personId: m.personId, punch: p });
          }
        }
        const decided = new Set((await tx.attendance.overtime(m.personId)).map((o) => o.date));
        for (const date of datesIn(since, addDays(today, -1))) {
          const d = day(date);
          if (d.status === 'complete' && d.overtimeMinutes > 0 && !decided.has(date)) {
            needsYou.push({
              kind: 'overtime',
              personId: m.personId,
              date,
              minutes: d.overtimeMinutes,
            });
          }
        }
      }
      return ok({ people, needsYou });
    });

/**
 * Approve or decline a day's overtime (§11.5, §11.6). Approved, it becomes
 * comp time hour for hour or paid at the multiplier, as the rules or the
 * member's choice say, and is posted to the pay period; comp time is also
 * banked in the ledger of the tenant's hour-unit leave type.
 */
export const decideOvertime =
  (deps: Pick<Deps, 'uow' | 'authz' | 'clock' | 'newId'>) =>
  (
    caller: Caller,
    input: {
      readonly personId: PersonId;
      readonly date: CalendarDate;
      readonly approve: boolean;
      readonly choice: 'comp' | 'paid' | null;
    },
  ): Promise<Result<OvertimeDecision>> =>
    transact(deps, caller.tenantId, async (tx) => {
      const approver =
        caller.personId !== input.personId &&
        ((await relates(deps, caller, 'approver', input.personId)) ||
          (await isHrAdmin(deps, caller)));
      if (!approver) return forbidden();
      const member = await tx.members.get(input.personId);
      if (member === null) return notFound('Member');
      if ((await tx.attendance.overtime(member.personId)).some((o) => o.date === input.date)) {
        return err(Conflict('This overtime was already decided'));
      }
      const clock = await clockOf(tx, member, caller.tenantId);
      const rules = await tx.attendance.rules();
      const day = dayOf({
        date: input.date,
        schedule: await scheduleOf(tx, member),
        shifts: clock.shifts,
        now: deps.clock.instant(),
        timeZone: member.timeZone,
        rules,
      });
      if (day.status !== 'complete' || day.overtimeMinutes === 0) {
        return refuse('NO_OVERTIME', 'There is no overtime on this day to decide', ['date']);
      }
      if (!input.approve) {
        const declined: OvertimeDecision = {
          personId: member.personId,
          date: input.date,
          minutes: day.overtimeMinutes,
          outcome: 'declined',
          decidedBy: caller.accountId,
        };
        await tx.attendance.decideOvertime(declined);
        return ok(declined);
      }
      const becomes = overtimeBecomes(day.overtimeMinutes, rules.overtime, input.choice);
      if (!becomes.ok) return becomes;
      const decision: OvertimeDecision = {
        personId: member.personId,
        date: input.date,
        minutes: becomes.value.minutes,
        outcome: becomes.value.use,
        decidedBy: caller.accountId,
      };
      await tx.attendance.decideOvertime(decision);

      await ensurePeriod(tx, deps, input.date);
      const line = postLine(await tx.attendance.periods(), await tx.attendance.lines(), {
        id: deps.newId(),
        personId: member.personId,
        team: member.teamKey ?? NO_TEAM,
        date: input.date,
        workedMinutes: day.workedMinutes ?? 0,
        compMinutes: decision.outcome === 'comp' ? decision.minutes : 0,
        paidMinutes: decision.outcome === 'paid' ? decision.minutes : 0,
        supersedes: null,
      });
      if (!line.ok) return line;
      await tx.attendance.appendLine(line.value);

      const comp = (await tx.leaveTypes.list()).find(
        (t) => t.definition.unit === 'hour' && t.definition.tracked && !t.deleted,
      );
      if (decision.outcome === 'comp' && comp !== undefined) {
        const ctx = contextFor(deps, userActor(caller), caller.correlationId, member.timeZone);
        const banked = await post(tx, [
          entry(
            {
              personId: member.personId,
              leaveTypeKey: comp.definition.key,
              unit: 'hour',
              kind: 'comp_earned',
              amount: hours(decision.minutes),
              effectiveOn: input.date,
            },
            ctx,
          ),
        ]);
        if (!banked.ok) return banked;
      }
      return ok(decision);
    });

/* ------------------------------------------------- HR's view, TOF-095 -- */

/** The holidays a member's work location observes between two dates, by name. */
async function holidaysOf(
  tx: Tx,
  member: Member,
  from: CalendarDate,
  to: CalendarDate,
): Promise<{ date: CalendarDate; name: string }[]> {
  if (member.locationKey === null) return [];
  const keys = await tx.holidays.assigned(member.locationKey);
  const layers = (await tx.holidays.layers()).filter((l) => keys.includes(l.key));
  const years = datesIn(from, to).map((d) => Number(d.slice(0, 4)));
  return [...new Set(years)]
    .flatMap((y) => resolveHolidays(layers, y))
    .filter((h) => h.date >= from && h.date <= to);
}

/** At most a year at once: the inspector asks for a period, not a career. */
const MAX_DAYS = 366;

async function hrPeriod(
  deps: Pick<Deps, 'authz'>,
  caller: Caller,
  from: CalendarDate,
  to: CalendarDate,
): Promise<Result<void>> {
  if (!(await isHrAdmin(deps, caller))) return forbidden();
  if (to < from) return refuse('INVALID_PERIOD', 'The range ends before it starts', ['to']);
  if (datesIn(from, to).length > MAX_DAYS) {
    return refuse('PERIOD_TOO_LONG', 'Ask for a year or less at once', ['to']);
  }
  return ok(undefined);
}

export interface AttendanceExceptions {
  readonly from: CalendarDate;
  readonly to: CalendarDate;
  readonly restMinutes: number;
  readonly items: readonly (Exception & {
    readonly personId: PersonId;
    readonly displayName: string;
    readonly teamName: string | null;
  })[];
}

/**
 * T23 (§11.7): every member's exceptions over a period, for HR — missed
 * clock-outs, short rest, overtime nobody decided and holidays worked —
 * oldest first. Days still to come are not asked about.
 */
export const attendanceExceptions =
  (deps: Pick<Deps, 'uow' | 'authz' | 'clock'>) =>
  (
    caller: Caller,
    input: { readonly from: CalendarDate; readonly to: CalendarDate },
  ): Promise<Result<AttendanceExceptions>> =>
    transact(deps, caller.tenantId, async (tx) => {
      const allowed = await hrPeriod(deps, caller, input.from, input.to);
      if (!allowed.ok) return allowed;
      const rules = await tx.attendance.rules();
      const now = deps.clock.instant();
      const items: AttendanceExceptions['items'][number][] = [];
      for (const m of await tx.members.list()) {
        if (m.status === 'left') continue;
        const today = deps.clock.date(m.timeZone);
        const to = input.to < today ? input.to : today;
        if (to < input.from) continue;
        const clock = await clockOf(tx, m, caller.tenantId);
        const schedule = await scheduleOf(tx, m);
        const days = datesIn(input.from, to).map((date) =>
          dayOf({ date, schedule, shifts: clock.shifts, now, timeZone: m.timeZone, rules }),
        );
        const found = exceptionsOf({
          days,
          restBreaches: restBreaches(clock.shifts, rules).filter(
            (r) => r.date >= input.from && r.date <= to,
          ),
          holidays: await holidaysOf(tx, m, input.from, to),
          decided: (await tx.attendance.overtime(m.personId)).map((o) => o.date),
        });
        for (const e of found) {
          items.push({
            ...e,
            personId: m.personId,
            displayName: m.displayName,
            teamName: m.teamName,
          });
        }
      }
      return ok({
        from: input.from,
        to: input.to,
        restMinutes: rules.restMinutes,
        items: items.toSorted((a, b) => a.date.localeCompare(b.date)),
      });
    });

export interface InspectorRecord {
  readonly from: CalendarDate;
  readonly to: CalendarDate;
  readonly people: readonly {
    readonly personId: PersonId;
    readonly displayName: string;
    readonly days: readonly DailyRecord[];
  }[];
}

/**
 * The labour inspector's record (§11.7): per person, each day's start, end
 * and breaks over a period, from the punches that stand. HR only; never a
 * location, a device or a source.
 */
export const inspectorRecord =
  (deps: Pick<Deps, 'uow' | 'authz'>) =>
  (
    caller: Caller,
    input: { readonly from: CalendarDate; readonly to: CalendarDate },
  ): Promise<Result<InspectorRecord>> =>
    transact(deps, caller.tenantId, async (tx) => {
      const allowed = await hrPeriod(deps, caller, input.from, input.to);
      if (!allowed.ok) return allowed;
      const people: InspectorRecord['people'][number][] = [];
      for (const m of (await tx.members.list()).toSorted((a, b) =>
        a.displayName.localeCompare(b.displayName),
      )) {
        const clock = await clockOf(tx, m, caller.tenantId);
        const days = dailyRecord(clock.shifts, m.timeZone).filter(
          (r) => r.date >= input.from && r.date <= input.to,
        );
        if (days.length > 0)
          people.push({ personId: m.personId, displayName: m.displayName, days });
      }
      return ok({ from: input.from, to: input.to, people });
    });

/** The month's pay period, opened when the first line needs it. */
async function ensurePeriod(tx: Tx, deps: Pick<Deps, 'newId'>, date: CalendarDate): Promise<void> {
  const periods = await tx.attendance.periods();
  if (periods.some((p) => p.from <= date && date <= p.to)) return;
  const from = CalendarDate.parse(`${date.slice(0, 8)}01`);
  await tx.attendance.savePeriod({
    id: deps.newId(),
    from,
    to: addDays(addMonths(from, 1), -1),
    closedAt: null,
  });
}

export interface ClosedPeriod {
  readonly periodId: string;
  readonly from: CalendarDate;
  readonly to: CalendarDate;
  /** Members on the event Payroll reads. */
  readonly members: number;
}

/**
 * "Send October to Payroll" (§11.8, T24): every complete day the month has
 * not had a line for is posted first — overtime decisions post their own —
 * then the period locks and `timeoff.period.closed` goes out with hours and
 * days, never punch times. HR only.
 *
 * ponytail: unpaid days count a whole unpaid request that starts in the
 * month; split it across months when an unpaid absence spanning a month end
 * matters to Payroll.
 */
export const closePayPeriod =
  (deps: Pick<Deps, 'uow' | 'authz' | 'clock' | 'newId'>) =>
  (caller: Caller, input: { readonly from: CalendarDate }): Promise<Result<ClosedPeriod>> =>
    transact(deps, caller.tenantId, async (tx) => {
      if (!(await isHrAdmin(deps, caller))) return forbidden();
      await ensurePeriod(tx, deps, input.from);
      const period = (await tx.attendance.periods()).find(
        (p) => p.from <= input.from && input.from <= p.to,
      );
      if (period === undefined) return notFound('Pay period');
      if (period.closedAt !== null) {
        return refuse('ALREADY_CLOSED', `${period.from} to ${period.to} is already closed`);
      }

      const rules = await tx.attendance.rules();
      const now = deps.clock.instant();
      const members = (await tx.members.list()).filter((m) => m.status !== 'left');
      const tracked = (await tx.leaveTypes.list()).filter(
        (t) => t.definition.tracked && t.definition.unit === 'day' && !t.deleted,
      );
      const balances = new Map<
        PersonId,
        { unpaidDays: DayAmount; negativeBalanceDays: DayAmount }
      >();
      for (const m of members) {
        const posted = new Set(
          (await tx.attendance.lines()).filter((l) => l.personId === m.personId).map((l) => l.date),
        );
        const clock = await clockOf(tx, m, caller.tenantId);
        const schedule = await scheduleOf(tx, m);
        for (const date of datesIn(period.from, period.to)) {
          if (posted.has(date)) continue;
          const day = dayOf({
            date,
            schedule,
            shifts: clock.shifts,
            now,
            timeZone: m.timeZone,
            rules,
          });
          if (day.status !== 'complete' || day.workedMinutes === null) continue;
          const line = postLine(await tx.attendance.periods(), await tx.attendance.lines(), {
            id: deps.newId(),
            personId: m.personId,
            team: m.teamKey ?? NO_TEAM,
            date,
            workedMinutes: day.workedMinutes,
            compMinutes: 0,
            paidMinutes: 0,
            supersedes: null,
          });
          if (!line.ok) return line;
          await tx.attendance.appendLine(line.value);
        }

        let negative = dayCount('0.000');
        for (const t of tracked) {
          const left = dayCount((await balanceFor(tx, m, t.definition.key, period.to)).left);
          if (left.lt(0)) negative = negative.plus(left.neg());
        }
        const unpaid = sum(
          (await tx.requests.list({ personIds: [m.personId], statuses: ['approved', 'taken'] }))
            .filter(
              (r) =>
                r.request.leaveType.paid === 'unpaid' &&
                r.request.span.from >= period.from &&
                r.request.span.from <= period.to,
            )
            .map((r) => dayCount(r.request.span.workingDays)),
        );
        if (!negative.isZero() || !unpaid.isZero()) {
          balances.set(m.personId, {
            unpaidDays: amount(unpaid),
            negativeBalanceDays: amount(negative),
          });
        }
      }

      const closed = close({
        periods: await tx.attendance.periods(),
        periodId: period.id,
        lines: await tx.attendance.lines(),
        balances,
        eventId: deps.newId(),
        tenantId: caller.tenantId,
        actor: userActor(caller),
        correlationId: caller.correlationId,
        clock: deps.clock,
      });
      if (!closed.ok) return closed;
      const locked = closed.value.periods.find((p) => p.id === period.id);
      if (locked !== undefined) await tx.attendance.savePeriod(locked);
      await tx.outbox.publish([closed.value.event]);
      const payload = closed.value.event.payload as { members: readonly unknown[] };
      return ok({
        periodId: period.id,
        from: period.from,
        to: period.to,
        members: payload.members.length,
      });
    });
