import { ok, type Result } from '@kithena/domain-kit';
import type { CalendarDate, LeaveTypeKey, PersonId } from '@kithena/contracts';

import { decideAdjustment, proposeAdjustment } from '../../domain/balance/adjustment.js';
import { entry } from '../../domain/balance/ledger.js';
import {
  contextFor,
  userActor,
  type Caller,
  type Deps,
  type Member,
  type StoredAdjustment,
  type Tx,
} from '../ports.js';
import {
  adjustedEvents,
  forbidden,
  isHrAdmin,
  notFound,
  post,
  refuse,
  relates,
  transact,
} from '../shared.js';

/**
 * Adding to or taking from someone's balance by hand, saying why (PRD §7.1).
 *
 * HR's goes into the ledger as it is made. A manager's — anyone who approves
 * the person's time off — waits for HR, and so does HR's own balance, which
 * another HR administrator decides. Nobody else may ask, and nobody decides
 * one they asked for.
 */

type AdjustDeps = Pick<Deps, 'uow' | 'authz' | 'clock' | 'newId' | 'notifier'>;

/** Into the ledger: an `adjustment` row carrying the reason, and `balance.adjusted`. */
async function postIt(
  tx: Tx,
  deps: Pick<Deps, 'clock' | 'newId'>,
  caller: Caller,
  member: Member,
  adjustment: StoredAdjustment,
): Promise<Result<StoredAdjustment>> {
  const leaveType = await tx.leaveTypes.get(adjustment.leaveTypeKey);
  const ctx = contextFor(deps, userActor(caller), caller.correlationId, member.timeZone);
  const row = entry(
    {
      personId: adjustment.personId,
      leaveTypeKey: adjustment.leaveTypeKey,
      unit: leaveType?.definition.unit ?? 'day',
      kind: 'adjustment',
      amount: adjustment.amount,
      effectiveOn: adjustment.effectiveOn,
      reason: adjustment.reason,
    },
    ctx,
  );
  const posted = await post(tx, [row]);
  if (!posted.ok) return posted;
  await tx.outbox.publish(adjustedEvents(ctx, caller.tenantId, [row]));
  return ok({ ...adjustment, entryId: row.entryId });
}

export const adjustBalance =
  (deps: AdjustDeps) =>
  (
    caller: Caller,
    input: {
      readonly personId: PersonId;
      readonly leaveTypeKey: LeaveTypeKey;
      readonly amount: string;
      readonly effectiveOn: CalendarDate | null;
      readonly reason: string;
    },
  ): Promise<Result<StoredAdjustment>> =>
    transact(deps, caller.tenantId, async (tx) => {
      const hr = await isHrAdmin(deps, caller);
      const own = caller.personId === input.personId;
      const manager = !own && (await relates(deps, caller, 'approver', input.personId));
      if (!hr && !manager) return forbidden();
      const member = await tx.members.get(input.personId);
      if (member === null) return notFound('Member');
      const leaveType = await tx.leaveTypes.get(input.leaveTypeKey);
      if (leaveType === null || leaveType.deleted) return notFound('Leave type');
      if (!leaveType.definition.tracked) {
        return refuse('NOT_TRACKED', 'This leave type is not taken from a balance', [
          'leaveTypeKey',
        ]);
      }
      const ctx = contextFor(deps, userActor(caller), caller.correlationId, member.timeZone);
      const made = proposeAdjustment(
        {
          ...input,
          effectiveOn: input.effectiveOn ?? deps.clock.date(member.timeZone),
          proposedBy: caller.accountId,
          byHr: hr && !own,
        },
        ctx,
      );
      if (!made.ok) return made;
      let saved: StoredAdjustment = { ...made.value, entryId: null };
      if (saved.status === 'approved') {
        const posted = await postIt(tx, deps, caller, member, saved);
        if (!posted.ok) return posted;
        saved = posted.value;
      } else {
        await deps.notifier.notify(
          caller.tenantId,
          'hr',
          { kind: 'adjustment_waiting', adjustmentId: saved.adjustmentId },
          `adjustment-waiting/${saved.adjustmentId}`,
        );
      }
      await tx.adjustments.save(saved);
      return ok(saved);
    });

export const decideBalanceAdjustment =
  (deps: AdjustDeps) =>
  (
    caller: Caller,
    input: {
      readonly adjustmentId: string;
      readonly approve: boolean;
      readonly note: string | null;
    },
  ): Promise<Result<StoredAdjustment>> =>
    transact(deps, caller.tenantId, async (tx) => {
      if (!(await isHrAdmin(deps, caller))) return forbidden();
      const held = await tx.adjustments.get(input.adjustmentId);
      if (held === null) return notFound('Adjustment');
      // HR's own balance is another HR administrator's to decide.
      if (held.personId === caller.personId) return forbidden();
      const member = await tx.members.get(held.personId);
      if (member === null) return notFound('Member');
      const ctx = contextFor(deps, userActor(caller), caller.correlationId, member.timeZone);
      const decided = decideAdjustment(
        held,
        { approve: input.approve, by: caller.accountId, note: input.note },
        ctx,
      );
      if (!decided.ok) return decided;
      let saved: StoredAdjustment = { ...decided.value, entryId: null };
      if (saved.status === 'approved') {
        const posted = await postIt(tx, deps, caller, member, saved);
        if (!posted.ok) return posted;
        saved = posted.value;
      }
      await tx.adjustments.save(saved);
      return ok(saved);
    });

export interface AdjustmentView extends StoredAdjustment {
  readonly displayName: string;
  readonly leaveTypeName: string;
  readonly unit: 'day' | 'hour';
  /** Whether this caller may approve or decline it now. */
  readonly canDecide: boolean;
}

/**
 * HR's queue and what was decided in the last 30 days; a manager sees the
 * ones they asked for. Anyone else sees nothing, rather than a refusal.
 */
export const balanceAdjustments =
  (deps: Pick<Deps, 'uow' | 'authz' | 'clock'>) =>
  (caller: Caller): Promise<Result<{ hr: boolean; items: readonly AdjustmentView[] }>> =>
    transact(deps, caller.tenantId, async (tx) => {
      const hr = await isHrAdmin(deps, caller);
      const month = new Date(Date.parse(deps.clock.instant()) - 30 * 86_400_000).toISOString();
      const all = [
        ...(await tx.adjustments.list({ status: 'pending' })),
        ...(await tx.adjustments.list({ since: month })).filter((a) => a.status !== 'pending'),
      ].filter((a) => hr || a.proposedBy === caller.accountId);
      const types = new Map((await tx.leaveTypes.list()).map((t) => [t.definition.key, t]));
      const items: AdjustmentView[] = [];
      for (const a of all) {
        const member = await tx.members.get(a.personId);
        const type = types.get(a.leaveTypeKey);
        items.push({
          ...a,
          displayName: member?.displayName ?? 'Someone',
          leaveTypeName: type?.definition.name.default ?? a.leaveTypeKey,
          unit: type?.definition.unit ?? 'day',
          canDecide:
            hr &&
            a.status === 'pending' &&
            a.personId !== caller.personId &&
            a.proposedBy !== caller.accountId,
        });
      }
      return ok({ hr, items });
    });
