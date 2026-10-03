import { ok, type Result } from '@kithena/domain-kit';
import type {
  CalendarDate,
  DayAmount,
  LedgerEntry,
  LeaveTypeKey,
  PersonId,
  TenantId,
} from '@kithena/contracts';

import { entry } from '../../domain/balance/ledger.js';
import { amount, days } from '../../domain/days.js';
import { postEntitlement, refold } from '../entitlement.js';
import {
  contextFor,
  systemActor,
  type Deps,
  type Member,
  type MemberFields,
  type Tx,
} from '../ports.js';
import {
  adjustedEvents,
  balanceFor,
  leaveYear,
  notFound,
  policyFor,
  post,
  transact,
} from '../shared.js';

/**
 * Keeping `timeoff.member` in step with whoever knows the person (PRD §5.2,
 * TOF-035). People's events (TOF-045) and the import (TOF-036) both become
 * these two commands; nothing downstream reads a People payload.
 *
 * Idempotent by event id, ordered by `effectiveFrom`: a redelivered event
 * changes nothing, and one older than the last applied is ignored.
 */

export interface Applied {
  /** The event that carried it, or `null` from an import. */
  readonly eventId: string | null;
  readonly effectiveFrom: CalendarDate | null;
  readonly correlationId: string;
}

const ACTOR = systemActor('timeoff-member-sync');

/** Whether an event has nothing to say to this member any more. */
function stale(member: Member | null, applied: Applied): boolean {
  if (member === null) return false;
  if (applied.eventId !== null && member.lastEventId === applied.eventId) return true;
  return (
    applied.effectiveFrom !== null &&
    member.lastEffectiveFrom !== null &&
    applied.effectiveFrom < member.lastEffectiveFrom
  );
}

/** The tracked leave types every member is granted. */
async function trackedTypes(tx: Tx): Promise<LeaveTypeKey[]> {
  return (await tx.leaveTypes.list())
    .filter((t) => t.definition.tracked && !t.deleted)
    .map((t) => t.definition.key);
}

export interface Upserted {
  readonly member: Member;
  readonly created: boolean;
  /** False when the event was already applied, or older than the last one. */
  readonly applied: boolean;
  /** The grant or accruals a hire posted. */
  readonly posted: readonly LedgerEntry[];
}

/**
 * Create or update a member. A new member is a hire: the year's entitlement
 * is posted for every tracked leave type whose policy applies, up to the
 * later of today and the hire date.
 */
export const upsertMember =
  (deps: Pick<Deps, 'uow' | 'clock' | 'newId'>) =>
  (tenantId: TenantId, fields: MemberFields, applied: Applied): Promise<Result<Upserted>> =>
    transact<Upserted>(deps, tenantId, async (tx) => {
      const existing = await tx.members.get(fields.personId);
      if (existing !== null && stale(existing, applied)) {
        return ok({ member: existing, created: false, applied: false, posted: [] });
      }
      const member: Member = {
        ...fields,
        lastEventId: applied.eventId ?? existing?.lastEventId ?? null,
        lastEffectiveFrom: applied.effectiveFrom ?? existing?.lastEffectiveFrom ?? null,
      };
      await tx.members.save(member);
      if (existing !== null) return ok({ member, created: false, applied: true, posted: [] });

      const ctx = contextFor(deps, ACTOR, applied.correlationId, member.timeZone);
      const today = deps.clock.date(member.timeZone);
      const on = member.hireDate > today ? member.hireDate : today;
      const posted: LedgerEntry[] = [];
      for (const key of await trackedTypes(tx)) {
        const policy = await policyFor(tx, member, key, on);
        if (policy === null) continue;
        const done = await postEntitlement(tx, ctx, member, policy.policy, on);
        if (!done.ok) return done;
        posted.push(...done.value);
      }
      return ok({ member, created: true, applied: true, posted });
    });

export interface Settlement {
  readonly leaveTypeKey: LeaveTypeKey;
  /** How far below zero the member left. */
  readonly days: DayAmount;
  readonly outcome: 'final_pay' | 'write_off' | 'hr_decides';
}

/**
 * A member leaves. The leave year is re-folded pro rata to the last day, and
 * a balance left below zero is settled as the policy says (§7.4): deducted
 * from final pay (the adjustment's event is what Payroll reads), written off,
 * or put to HR.
 *
 * ponytail: the projection does not know whether the contract has a
 * deduction clause, so `final_pay` deducts for everyone; the settings page's
 * "members whose contract lacks it" needs that field first.
 */
export const endMember =
  (deps: Pick<Deps, 'uow' | 'clock' | 'newId' | 'notifier'>) =>
  (
    tenantId: TenantId,
    personId: PersonId,
    terminationDate: CalendarDate,
    applied: Applied,
  ): Promise<Result<{ member: Member; settled: readonly Settlement[] }>> =>
    transact(deps, tenantId, async (tx) => {
      const existing = await tx.members.get(personId);
      if (existing === null) return notFound('Member');
      if (stale(existing, applied)) return ok({ member: existing, settled: [] });

      const today = deps.clock.date(existing.timeZone);
      const member: Member = {
        ...existing,
        terminationDate,
        status: terminationDate <= today ? 'left' : existing.status,
        lastEventId: applied.eventId ?? existing.lastEventId,
        lastEffectiveFrom: applied.effectiveFrom ?? existing.lastEffectiveFrom,
      };
      await tx.members.save(member);

      const ctx = contextFor(deps, ACTOR, applied.correlationId, member.timeZone);
      const settled: Settlement[] = [];
      const hr: Settlement[] = [];
      for (const key of await trackedTypes(tx)) {
        const policy = await policyFor(tx, member, key, terminationDate);
        if (policy === null) continue;
        const { start } = leaveYear(policy.definition, terminationDate);
        const folded = await refold(tx, ctx, member, policy.policy, start, today);
        if (!folded.ok) return folded;

        const left = days((await balanceFor(tx, member, key, terminationDate)).left);
        if (left.gte(0)) continue;
        const outcome = policy.definition.negativeBalance?.onLeaving ?? 'final_pay';
        const settlement = { leaveTypeKey: key, days: amount(left.neg()), outcome };
        settled.push(settlement);
        if (outcome === 'hr_decides') {
          hr.push(settlement);
          continue;
        }
        const leaveType = await tx.leaveTypes.get(key);
        const adjustment = entry(
          {
            personId,
            leaveTypeKey: key,
            unit: leaveType?.definition.unit ?? 'day',
            kind: 'adjustment',
            amount: left.neg(),
            effectiveOn: terminationDate,
            policyVersion: policy.version,
            reason: outcome === 'final_pay' ? 'Deducted from final pay' : 'Written off on leaving',
          },
          ctx,
        );
        const posted = await post(tx, [adjustment]);
        if (!posted.ok) return posted;
        await tx.outbox.publish(adjustedEvents(ctx, tenantId, [adjustment]));
      }
      for (const s of hr) {
        await deps.notifier.notify(
          tenantId,
          'hr',
          { kind: 'negative_on_leaving', leaveTypeKey: s.leaveTypeKey, days: s.days },
          `negative-on-leaving/${personId}/${s.leaveTypeKey}/${terminationDate}`,
        );
      }
      return ok({ member, settled });
    });
