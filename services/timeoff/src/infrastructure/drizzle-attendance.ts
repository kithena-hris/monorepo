import { createHash } from 'node:crypto';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type {
  AttendanceWorkModel,
  CalendarDate,
  PersonId,
  PunchKind,
  PunchSource,
  TeamKey,
  TenantId,
} from '@kithena/contracts';

import { DEFAULT_RULES, type AttendanceRules } from '../domain/attendance/day.js';
import type { Schedule } from '../domain/attendance/schedule.js';
import type {
  AttendanceStore,
  KioskDevice,
  KioskStore,
  OvertimeDecision,
} from '../application/ports.js';
import { instantOf } from './drizzle-leave.js';
import { readSetting, writeSetting } from './drizzle-settings.js';
import {
  kioskCredential,
  kioskDevice,
  memberSchedule,
  overtimeDecision,
  payPeriod,
  payPeriodLine,
  punch,
  schedule,
} from './tables.js';

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

export function drizzleAttendance(tx: PostgresJsDatabase, tenantId: TenantId): AttendanceStore {
  return {
    async punches(personId) {
      const rows = await tx
        .select()
        .from(punch)
        .where(eq(punch.personId, personId))
        .orderBy(asc(punch.recordedAt), asc(punch.id));
      return rows.map((r) => ({
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
      }));
    },
    async appendPunch(personId, p) {
      await tx.insert(punch).values({ tenantId, personId, ...p });
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

    rules: () => readSetting<AttendanceRules>(tx, 'attendance_rules', DEFAULT_RULES),
    setRules: (rules) => writeSetting(tx, tenantId, 'attendance_rules', rules),

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
