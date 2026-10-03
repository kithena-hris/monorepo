import { ok, type Result } from '@kithena/domain-kit';
import type { LedgerEntry, LeaveTypeKey, TenantId } from '@kithena/contracts';

import { AttendanceClock } from '../domain/attendance/clock.js';
import { openDays } from '../domain/attendance/correction.js';
import { carryOverExpiry } from '../domain/balance/entitlement.js';
import { entry } from '../domain/balance/ledger.js';
import { addDays, amount, days } from '../domain/days.js';
import { DEFAULT_SCHEDULE } from './attendance/attendance.js';
import { postEntitlement } from './entitlement.js';
import { contextFor, systemActor, type Deps, type Member, type Tx } from './ports.js';
import { persist } from './request/request.js';
import {
  adjustedEvents,
  balanceFor,
  leaveYear,
  live,
  policyFor,
  post,
  transact,
} from './shared.js';
import { localMinutes } from './zone.js';

/**
 * What Time Off does that no request asks for (TOF-043), one tenant at a
 * time. Each reads "today" from the injected clock on the member's own
 * calendar, and each is idempotent, so a job run twice, or by two replicas,
 * posts and tells nothing twice: a ledger row is "already there" by kind and
 * day, and a notice by its dedupe key.
 */

type JobDeps = Pick<Deps, 'uow' | 'clock' | 'newId' | 'notifier'>;

const ACTOR = systemActor('timeoff-jobs');
const CORRELATION = '00000000-0000-4000-8000-00000000a0b5';

async function trackedTypes(tx: Tx): Promise<LeaveTypeKey[]> {
  return (await tx.leaveTypes.list())
    .filter((t) => t.definition.tracked && !t.deleted)
    .map((t) => t.definition.key);
}

async function current(tx: Tx): Promise<Member[]> {
  return (await tx.members.list()).filter((m) => m.status !== 'left');
}

/**
 * The monthly accrual, and the upfront grant on a new leave year (§7.1):
 * whatever each member's policy has made due by today and is not posted yet.
 */
export const postAccruals =
  (deps: JobDeps) =>
  (tenantId: TenantId): Promise<Result<readonly LedgerEntry[]>> =>
    transact(deps, tenantId, async (tx) => {
      const posted: LedgerEntry[] = [];
      for (const member of await current(tx)) {
        const ctx = contextFor(deps, ACTOR, CORRELATION, member.timeZone);
        const today = deps.clock.date(member.timeZone);
        for (const key of await trackedTypes(tx)) {
          const policy = await policyFor(tx, member, key, today);
          if (policy === null) continue;
          const done = await postEntitlement(tx, ctx, member, policy.policy, today);
          if (!done.ok) return done;
          posted.push(...done.value);
        }
      }
      return ok(posted);
    });

/**
 * The leave year turning over (§6.2, §7.4): what is left carries in up to the
 * policy's cap; a balance left below zero is taken from the new year when the
 * policy says so; and carried days still unused on the use-by date expire the
 * day after it.
 */
export const yearEnd =
  (deps: JobDeps) =>
  (tenantId: TenantId): Promise<Result<readonly LedgerEntry[]>> =>
    transact(deps, tenantId, async (tx) => {
      const posted: LedgerEntry[] = [];
      for (const member of await current(tx)) {
        const ctx = contextFor(deps, ACTOR, CORRELATION, member.timeZone);
        const today = deps.clock.date(member.timeZone);
        for (const key of await trackedTypes(tx)) {
          const policy = await policyFor(tx, member, key, today);
          if (policy === null) continue;
          const { year, start, end } = leaveYear(policy.definition, today);
          if (member.hireDate >= start) continue;
          const closing = days((await balanceFor(tx, member, key, addDays(start, -1))).left);

          const carried = await postEntitlement(
            tx,
            ctx,
            member,
            policy.policy,
            today,
            closing.gt(0) ? amount(closing) : null,
          );
          if (!carried.ok) return carried;
          posted.push(...carried.value);

          const mine = live(await tx.ledger.forMember(member.personId, key));
          const reason = `Below zero at the end of ${String(year - 1)}`;
          if (
            closing.lt(0) &&
            policy.definition.negativeBalance?.atYearEnd === 'next_year' &&
            !mine.some(
              (e) => e.kind === 'adjustment' && e.effectiveOn === start && e.reason === reason,
            )
          ) {
            const borrowed = entry(
              {
                personId: member.personId,
                leaveTypeKey: key,
                unit: 'day',
                kind: 'adjustment',
                amount: amount(closing),
                effectiveOn: start,
                policyVersion: policy.version,
                reason,
              },
              ctx,
            );
            const done = await post(tx, [borrowed]);
            if (!done.ok) return done;
            await tx.outbox.publish(adjustedEvents(ctx, tenantId, [borrowed]));
            posted.push(borrowed);
          }

          const expiry = carryOverExpiry(
            {
              ledger: mine.filter((e) => e.effectiveOn >= start && e.effectiveOn <= end),
              policy: policy.definition,
              year,
            },
            ctx,
          );
          if (
            expiry !== null &&
            today > expiry.effectiveOn &&
            !mine.some((e) => e.kind === 'expiry' && e.effectiveOn === expiry.effectiveOn)
          ) {
            const done = await post(tx, [expiry]);
            if (!done.ok) return done;
            await tx.outbox.publish(adjustedEvents(ctx, tenantId, [expiry]));
            posted.push(expiry);
          }
        }
      }
      return ok(posted);
    });

/** "Use it or lose it", on 1 October and 1 December: more left than will carry over. */
export const balanceWarnings =
  (deps: JobDeps) =>
  (tenantId: TenantId): Promise<Result<number>> =>
    transact(deps, tenantId, async (tx) => {
      let told = 0;
      for (const member of await current(tx)) {
        const today = deps.clock.date(member.timeZone);
        if (!['10-01', '12-01'].includes(today.slice(5))) continue;
        for (const key of await trackedTypes(tx)) {
          const policy = await policyFor(tx, member, key, today);
          const cap = policy?.definition.carryOver?.maxDays;
          if (cap === undefined) continue;
          const left = (await balanceFor(tx, member, key, today)).left;
          if (days(left).lte(cap)) continue;
          await deps.notifier.notify(
            tenantId,
            member.personId,
            { kind: 'use_it_or_lose_it', leaveTypeKey: key, left, carries: cap },
            `use-it/${member.personId}/${key}/${today}`,
          );
          told++;
        }
      }
      return ok(told);
    });

/** Approved requests whose last day has passed settle into "taken" (§8.1). */
export const markTakenDue =
  (deps: JobDeps) =>
  (tenantId: TenantId): Promise<Result<number>> =>
    transact(deps, tenantId, async (tx) => {
      let settled = 0;
      for (const record of await tx.requests.list({ statuses: ['approved'] })) {
        const member = await tx.members.get(record.request.personId);
        if (member === null) continue;
        if (record.request.span.to >= deps.clock.date(member.timeZone)) continue;
        const ctx = contextFor(deps, ACTOR, CORRELATION, member.timeZone);
        const entries = record.request.markTaken(ctx);
        if (!entries.ok) return entries;
        const saved = await persist(tx, record, entries.value);
        if (!saved.ok) return saved;
        settled++;
      }
      return ok(settled);
    });

async function clockOf(tx: Tx, tenantId: TenantId, member: Member): Promise<AttendanceClock> {
  return AttendanceClock.of({
    tenantId,
    personId: member.personId,
    timeZone: member.timeZone,
    punches: await tx.attendance.punches(member.personId),
  });
}

/** The morning check (§11.4): each day left without a clock-out, asked about once. */
export const missedPunchCheck =
  (deps: JobDeps) =>
  (tenantId: TenantId): Promise<Result<number>> =>
    transact(deps, tenantId, async (tx) => {
      let asked = 0;
      const now = deps.clock.instant();
      for (const member of await current(tx)) {
        const clock = await clockOf(tx, tenantId, member);
        const schedule = (await tx.attendance.schedule(member.personId)) ?? DEFAULT_SCHEDULE;
        for (const open of openDays({
          shifts: clock.shifts,
          schedule,
          now,
          timeZone: member.timeZone,
        })) {
          await deps.notifier.notify(
            tenantId,
            member.personId,
            { kind: 'missed_clock_out', date: open.date },
            `missed/${member.personId}/${open.date}`,
          );
          asked++;
        }
      }
      return ok(asked);
    });

const REMIND_FROM = 20 * 60;

/**
 * "Remind people not clocked out by 20:00" (T33): once a day, from 20:00 on
 * the member's clock, to anyone still in or on a break. Never an automatic
 * clock-out, which can hide real overtime.
 */
export const clockOutReminder =
  (deps: JobDeps) =>
  (tenantId: TenantId): Promise<Result<number>> =>
    transact(deps, tenantId, async (tx) => {
      let reminded = 0;
      const now = deps.clock.now();
      for (const member of await current(tx)) {
        if (localMinutes(now, member.timeZone) < REMIND_FROM) continue;
        const clock = await clockOf(tx, tenantId, member);
        if (clock.state === 'out') continue;
        await deps.notifier.notify(
          tenantId,
          member.personId,
          { kind: 'still_clocked_in' },
          `still-in/${member.personId}/${deps.clock.date(member.timeZone)}`,
        );
        reminded++;
      }
      return ok(reminded);
    });
