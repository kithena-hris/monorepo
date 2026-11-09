import { createHash } from 'node:crypto';
import { and, asc, desc, eq, gt, gte, inArray, isNotNull, lt, lte, or, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type {
  AttendanceWorkModel,
  CalendarDate,
  Instant,
  PersonId,
  PunchKind,
  PunchSource,
  TeamKey,
  TenantId,
} from '@kithena/contracts';

import { DEFAULT_RULES, type AttendanceRules, type WorkedDay } from '../domain/attendance/day.js';
import type { Punch } from '../domain/attendance/clock.js';
import type { Schedule } from '../domain/attendance/schedule.js';
import type {
  AttendanceStore,
  KioskDevice,
  KioskStore,
  MemberDay,
  OvertimeDecision,
} from '../application/ports.js';
import { addDays, addMonths } from '../domain/days.js';
import { instantOf } from './drizzle-leave.js';
import { readSetting, writeSetting } from './drizzle-settings.js';
import {
  attendanceDay,
  attendanceMonth,
  kioskCredential,
  kioskDevice,
  memberSchedule,
  overtimeDecision,
  payPeriod,
  payPeriodLine,
  punch,
  schedule,
} from './tables.js';

/** A date's month, as its first day. */
const firstOf = (date: CalendarDate): CalendarDate => `${date.slice(0, 7)}-01` as CalendarDate;
/** A month's days, summed: the clock-outs nobody made, and the overtime of finished days. */
const missedOf = sql<number>`count(*) filter (where ${attendanceDay.status} = 'open')::int`;
const overtimeOf = sql<number>`coalesce(sum(${attendanceDay.overtimeMinutes}) filter (where ${attendanceDay.status} = 'complete'), 0)::int`;

/**
 * Punches, schedules, pay periods and overtime decisions (TOF-033), bound to
 * one tenant transaction. Punches and lines are insert-only in the table as
 * in the port.
 */

/**
 * A schedule's key is its content's hash: the port hands over a schedule, not
 * a name for it, and two members on the same hours share one row.
 */
const keyOf = (s: Schedule): string =>
  `s_${createHash('sha256').update(JSON.stringify(s)).digest('hex').slice(0, 32)}`;

const punchOf = (r: typeof punch.$inferSelect): Punch => ({
  id: r.id,
  at: instantOf(r.at),
  recordedAt: instantOf(r.recordedAt),
  kind: r.kind as PunchKind,
  source: r.source as PunchSource,
  workModel: r.workModel as AttendanceWorkModel,
  deviceId: r.deviceId,
  insideOfficeArea: r.insideOfficeArea,
  supersedes: r.supersedes,
  reason: r.reason,
  ...(r.clockSkewSeconds === null ? {} : { clockSkewSeconds: r.clockSkewSeconds }),
});

export function drizzleAttendance(tx: PostgresJsDatabase, tenantId: TenantId): AttendanceStore {
  const punchesOf = async (
    personIds: readonly PersonId[],
    window?: { readonly from: Instant; readonly to: Instant },
  ): Promise<Map<PersonId, Punch[]>> => {
    const out = new Map<PersonId, Punch[]>(personIds.map((id) => [id, []]));
    if (personIds.length === 0) return out;
    // Through `punch_timeline_idx` (tenant, person, at): a period reads its own days.
    const rows = await tx
      .select()
      .from(punch)
      .where(
        and(
          inArray(punch.personId, [...personIds]),
          window === undefined ? undefined : gte(punch.at, window.from),
          window === undefined ? undefined : lte(punch.at, window.to),
        ),
      )
      .orderBy(asc(punch.recordedAt), asc(punch.id));
    for (const r of rows) out.get(r.personId as PersonId)?.push(punchOf(r));
    return out;
  };
  return {
    async punches(personId) {
      return (await punchesOf([personId])).get(personId) ?? [];
    },
    punchesOf,
    async appendPunch(personId, p) {
      await tx.insert(punch).values({ tenantId, personId, ...p });
    },

    /** Each member's latest assignment, in one query. */
    async schedulesOf(personIds) {
      if (personIds.length === 0) return new Map();
      const rows = await tx
        .selectDistinctOn([memberSchedule.personId], {
          personId: memberSchedule.personId,
          definition: schedule.definition,
        })
        .from(memberSchedule)
        .innerJoin(schedule, eq(schedule.key, memberSchedule.scheduleKey))
        .where(inArray(memberSchedule.personId, [...personIds]))
        .orderBy(memberSchedule.personId, desc(memberSchedule.effectiveFrom));
      return new Map(rows.map((r) => [r.personId as PersonId, r.definition as Schedule]));
    },
    /** The member's latest assignment. */
    async schedule(personId) {
      const [r] = await tx
        .select({ definition: schedule.definition })
        .from(memberSchedule)
        .innerJoin(schedule, eq(schedule.key, memberSchedule.scheduleKey))
        .where(eq(memberSchedule.personId, personId))
        .orderBy(desc(memberSchedule.effectiveFrom))
        .limit(1);
      return r === undefined ? null : (r.definition as Schedule);
    },
    /**
     * From today, on the database's calendar: the port has no date, and a
     * second change on one day replaces the first.
     */
    async setSchedule(personId, s) {
      const key = keyOf(s);
      await tx
        .insert(schedule)
        .values({ tenantId, key, name: s.name, kind: s.kind, definition: s })
        .onConflictDoUpdate({
          target: [schedule.tenantId, schedule.key],
          set: { name: s.name },
        });
      // An assignment is never updated (no UPDATE grant): today's is replaced.
      await tx
        .delete(memberSchedule)
        .where(
          and(
            eq(memberSchedule.personId, personId),
            eq(memberSchedule.effectiveFrom, sql`current_date`),
          ),
        );
      await tx
        .insert(memberSchedule)
        .values({ tenantId, personId, effectiveFrom: sql`current_date`, scheduleKey: key });
    },

    // A document saved before a rule existed takes that rule's default.
    rules: async () => {
      const saved = await readSetting<Partial<AttendanceRules>>(tx, 'attendance_rules', {});
      return {
        ...DEFAULT_RULES,
        ...saved,
        clockIn: { ...DEFAULT_RULES.clockIn, ...saved.clockIn },
      };
    },
    setRules: (rules) => writeSetting(tx, tenantId, 'attendance_rules', rules),
    defaultSchedule: () => readSetting<Schedule | null>(tx, 'default_schedule', null),
    setDefaultSchedule: (s) => writeSetting(tx, tenantId, 'default_schedule', s),

    async periods() {
      const rows = await tx.select().from(payPeriod).orderBy(asc(payPeriod.startsOn));
      return rows.map((r) => ({
        id: r.id,
        from: r.startsOn as CalendarDate,
        to: r.endsOn as CalendarDate,
        closedAt: r.closedAt === null ? null : instantOf(r.closedAt),
      }));
    },
    /** A closed period is never written again; the table would refuse it. */
    async savePeriod(p) {
      const values = { startsOn: p.from, endsOn: p.to, closedAt: p.closedAt };
      await tx
        .insert(payPeriod)
        .values({ tenantId, id: p.id, ...values })
        .onConflictDoUpdate({
          target: [payPeriod.tenantId, payPeriod.id],
          set: values,
          setWhere: sql`pay_period.closed_at IS NULL`,
        });
    },

    async lines() {
      const rows = await tx
        .select()
        .from(payPeriodLine)
        .orderBy(asc(payPeriodLine.createdAt), asc(payPeriodLine.id));
      return rows.map((r) => ({
        id: r.id,
        personId: r.personId as PersonId,
        team: r.teamKey as TeamKey,
        date: r.day as CalendarDate,
        periodId: r.periodId,
        workedMinutes: r.workedMinutes,
        compMinutes: r.compMinutes,
        paidMinutes: r.paidMinutes,
        supersedes: r.supersedes,
      }));
    },
    async appendLine(l) {
      await tx.insert(payPeriodLine).values({
        tenantId,
        id: l.id,
        periodId: l.periodId,
        personId: l.personId,
        teamKey: l.team,
        day: l.date,
        workedMinutes: l.workedMinutes,
        compMinutes: l.compMinutes,
        paidMinutes: l.paidMinutes,
        supersedes: l.supersedes,
      });
    },

    async overtimeOf(personIds) {
      if (personIds.length === 0) return new Map();
      const rows = await tx
        .select()
        .from(overtimeDecision)
        .where(inArray(overtimeDecision.personId, [...personIds]))
        .orderBy(asc(overtimeDecision.day));
      const out = new Map<PersonId, OvertimeDecision[]>();
      for (const r of rows) {
        const id = r.personId as PersonId;
        const list = out.get(id) ?? [];
        list.push({
          personId: id,
          date: r.day as CalendarDate,
          minutes: r.minutes,
          outcome: r.outcome as OvertimeDecision['outcome'],
          decidedBy: r.decidedBy,
        });
        out.set(id, list);
      }
      return out;
    },
    async overtime(personId) {
      const rows = await tx
        .select()
        .from(overtimeDecision)
        .where(eq(overtimeDecision.personId, personId))
        .orderBy(asc(overtimeDecision.day));
      return rows.map((r): OvertimeDecision => ({
        personId: r.personId as PersonId,
        date: r.day as CalendarDate,
        minutes: r.minutes,
        outcome: r.outcome as OvertimeDecision['outcome'],
        decidedBy: r.decidedBy,
      }));
    },
    async decideOvertime(d) {
      await tx.insert(overtimeDecision).values({
        tenantId,
        personId: d.personId,
        day: d.date,
        minutes: d.minutes,
        outcome: d.outcome,
        decidedBy: d.decidedBy,
      });
    },

    async workedDays(q) {
      if (q.personIds?.length === 0) return [];
      const rows = await tx
        .select()
        .from(attendanceDay)
        .where(
          and(
            // Named, so a company-wide period reads `attendance_day_period_idx`.
            eq(attendanceDay.tenantId, tenantId),
            gte(attendanceDay.date, q.from),
            lte(attendanceDay.date, q.to),
            q.personIds === undefined
              ? undefined
              : inArray(attendanceDay.personId, [...q.personIds]),
            q.statuses === undefined ? undefined : inArray(attendanceDay.status, [...q.statuses]),
            q.notable === undefined
              ? undefined
              : or(
                  eq(attendanceDay.status, 'open'),
                  gt(attendanceDay.overtimeMinutes, 0),
                  isNotNull(attendanceDay.restMinutes),
                  q.notable.orOn.length === 0
                    ? undefined
                    : inArray(attendanceDay.date, [...q.notable.orOn]),
                ),
          ),
        )
        .orderBy(asc(attendanceDay.date));
      return rows.map((r): MemberDay => ({
        personId: r.personId as PersonId,
        date: r.date as CalendarDate,
        status: r.status as WorkedDay['status'],
        workedMinutes: r.workedMinutes,
        overtimeMinutes: r.overtimeMinutes,
        restMinutes: r.restMinutes,
      }));
    },

    async keepWorkedDays(personId, from, to, days) {
      await tx
        .delete(attendanceDay)
        .where(
          and(
            eq(attendanceDay.tenantId, tenantId),
            eq(attendanceDay.personId, personId),
            gte(attendanceDay.date, from),
            lte(attendanceDay.date, to),
          ),
        );
      if (days.length > 0) {
        await tx.insert(attendanceDay).values(days.map((d) => ({ tenantId, personId, ...d })));
      }
      // The months these days fall in, summed again (`attendance_month`).
      const first = firstOf(from);
      const last = firstOf(to);
      await tx
        .delete(attendanceMonth)
        .where(
          and(
            eq(attendanceMonth.tenantId, tenantId),
            eq(attendanceMonth.personId, personId),
            gte(attendanceMonth.month, first),
            lte(attendanceMonth.month, last),
          ),
        );
      const month = sql<CalendarDate>`date_trunc('month', ${attendanceDay.date})::date`;
      await tx.insert(attendanceMonth).select(
        tx
          .select({
            tenantId: attendanceDay.tenantId,
            personId: attendanceDay.personId,
            month: month.as('month'),
            missedClockOuts: missedOf.as('missed_clock_outs'),
            overtimeMinutes: overtimeOf.as('overtime_minutes'),
          })
          .from(attendanceDay)
          .where(
            and(
              eq(attendanceDay.tenantId, tenantId),
              eq(attendanceDay.personId, personId),
              gte(attendanceDay.date, first),
              lte(attendanceDay.date, addDays(addMonths(last, 1), -1)),
            ),
          )
          .groupBy(attendanceDay.tenantId, attendanceDay.personId, month),
      );
    },

    async workedMonths(from, to) {
      // Whole months from their sums; the days of a month only partly asked
      // for (this one, still under way) from the days themselves.
      const start = from === firstOf(from) ? from : addMonths(firstOf(from), 1);
      const after = addDays(to, 1);
      const end = after === firstOf(after) ? after : firstOf(to);
      const whole = start < end;
      const summed = whole
        ? await tx
            .select({
              personId: attendanceMonth.personId,
              month: sql<string>`to_char(${attendanceMonth.month}, 'YYYY-MM')`,
              missedClockOuts: attendanceMonth.missedClockOuts,
              overtimeMinutes: attendanceMonth.overtimeMinutes,
            })
            .from(attendanceMonth)
            .where(
              and(
                eq(attendanceMonth.tenantId, tenantId),
                gte(attendanceMonth.month, start),
                lt(attendanceMonth.month, end),
              ),
            )
        : [];
      // Each as a plain range of dates, which the period index answers: as one
      // range less the whole months, Postgres read every day of the range.
      const ranges: (readonly [CalendarDate, CalendarDate])[] = whole
        ? [
            ...(from < start ? [[from, addDays(start, -1)] as const] : []),
            ...(end <= to ? [[end, to] as const] : []),
          ]
        : [[from, to]];
      const month = sql<string>`to_char(${attendanceDay.date}, 'YYYY-MM')`;
      const partly = (
        await Promise.all(
          ranges.map(([first, last]) =>
            tx
              .select({
                personId: attendanceDay.personId,
                month,
                missedClockOuts: missedOf,
                overtimeMinutes: overtimeOf,
              })
              .from(attendanceDay)
              .where(
                and(
                  eq(attendanceDay.tenantId, tenantId),
                  gte(attendanceDay.date, first),
                  lte(attendanceDay.date, last),
                ),
              )
              .groupBy(attendanceDay.personId, month),
          ),
        )
      ).flat();
      return [...summed, ...partly].map((r) => ({ ...r, personId: r.personId as PersonId }));
    },
  };
}

const deviceOf = (r: typeof kioskDevice.$inferSelect): KioskDevice => ({
  id: r.id,
  name: r.name,
  locationKey: r.locationKey as KioskDevice['locationKey'],
  tokenHash: r.tokenHash,
  lastSeenAt: r.lastSeenAt === null ? null : instantOf(r.lastSeenAt),
  revokedAt: r.revokedAt === null ? null : instantOf(r.revokedAt),
  lastSequence: r.lastSequence,
});

/** Kiosk devices and members' badges and PINs (TOF-107), hashes only. */
export function drizzleKiosks(tx: PostgresJsDatabase, tenantId: TenantId): KioskStore {
  return {
    async device(id) {
      const [r] = await tx.select().from(kioskDevice).where(eq(kioskDevice.id, id));
      return r === undefined ? null : deviceOf(r);
    },
    async devices() {
      return (await tx.select().from(kioskDevice)).map(deviceOf);
    },
    async saveDevice(d) {
      const row = {
        name: d.name,
        locationKey: d.locationKey,
        tokenHash: d.tokenHash,
        lastSeenAt: d.lastSeenAt,
        revokedAt: d.revokedAt,
        lastSequence: d.lastSequence,
      };
      await tx
        .insert(kioskDevice)
        .values({ tenantId, id: d.id, ...row })
        .onConflictDoUpdate({ target: [kioskDevice.tenantId, kioskDevice.id], set: row });
    },
    async holder(kind, hash) {
      const [r] = await tx
        .select({ personId: kioskCredential.personId })
        .from(kioskCredential)
        .where(and(eq(kioskCredential.kind, kind), eq(kioskCredential.hash, hash)));
      return r === undefined ? null : (r.personId as PersonId);
    },
    async setCredential(personId, kind, hash) {
      await tx
        .delete(kioskCredential)
        .where(and(eq(kioskCredential.personId, personId), eq(kioskCredential.kind, kind)));
      if (hash !== null)
        await tx.insert(kioskCredential).values({ tenantId, personId, kind, hash });
    },
  };
}
