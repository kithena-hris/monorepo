import { fixedClock, ok, type Result } from '@kithena/domain-kit';
import type { PersonId, TenantId } from '@kithena/contracts';

import { escalation, type Delegation } from '../../domain/approval/delegation.js';
import { isWorkingDay } from '../../domain/calendar/working-days.js';
import type { LeaveRequestId } from '../../domain/request/leave-request.js';
import { DEFAULT_ESCALATION, type Caller, type Deps } from '../ports.js';
import { calendarOf, forbidden, isHrAdmin, notFound, refuse, transact } from '../shared.js';
import { localMinutes, msUntilLocal } from '../zone.js';

/**
 * Delegation and escalation (PRD §9.7, TOF-039).
 *
 * A delegate covers an approver for a range, or whenever the approver's own
 * time off is approved; the `delegate` relation (TOF-048) answers whether
 * they may decide on a given day. Nothing waits longer than three working
 * days: then it goes to the approver's manager, with a reminder at 09:00
 * every day until somebody decides.
 *
 * The timer is a Temporal workflow per pending request
 * (`infrastructure/temporal/escalation.ts`), behind the `ApprovalTimers`
 * port. The workflow holds nothing and decides nothing: on each wake-up it
 * calls `escalationTick` with its own notion of now, and sleeps for as long
 * as the answer says.
 */

/** The approver's own delegation: they set it, or HR does for them. */
export const setDelegation =
  (deps: Pick<Deps, 'uow' | 'authz'>) =>
  (
    caller: Caller,
    delegation: Delegation | { readonly approverId: PersonId; readonly remove: true },
  ): Promise<Result<void>> =>
    transact(deps, caller.tenantId, async (tx) => {
      if (caller.personId !== delegation.approverId && !(await isHrAdmin(deps, caller))) {
        return forbidden();
      }
      if ('remove' in delegation) {
        await tx.approvals.removeDelegation(delegation.approverId);
        return ok(undefined);
      }
      if (delegation.delegateId === delegation.approverId) {
        return refuse('SELF_DELEGATION', 'Choose someone else to cover for you', ['delegateId']);
      }
      if ((await tx.members.get(delegation.delegateId)) === null) return notFound('Delegate');
      if (delegation.range !== null && delegation.range.to < delegation.range.from) {
        return refuse('INVALID_PERIOD', 'Cover cannot end before it starts', ['range']);
      }
      await tx.approvals.saveDelegation(delegation);
      return ok(undefined);
    });

export interface Tick {
  /** False once the request is decided or withdrawn: the workflow ends. */
  readonly open: boolean;
  /** How long to sleep before asking again. */
  readonly sleepMs: number;
  readonly escalated: boolean;
}

/**
 * One wake-up of a pending request's timer. `now` is the caller's: the
 * workflow's own time, so a test server that skips three days skips them
 * here too. Escalates when the working days HR set (three by default) have
 * passed since the step started waiting, to the approver's manager or to HR;
 * reminds whoever decides now, once a day, from the hour HR set (09:00).
 */
export const escalationTick =
  (deps: Pick<Deps, 'uow' | 'newId' | 'notifier'>) =>
  (tenantId: TenantId, requestId: LeaveRequestId, now: string): Promise<Result<Tick>> => {
    const clock = fixedClock(now);
    return transact<Tick>(deps, tenantId, async (tx) => {
      const record = await tx.requests.get(requestId);
      if (record === null) return notFound('Request');
      const { request, routing } = record;
      const role = routing.chain[routing.step];
      if (
        (request.status !== 'pending' && request.status !== 'change_pending') ||
        role === undefined
      ) {
        return ok({ open: false, sleepMs: 0, escalated: false });
      }
      const member = await tx.members.get(request.personId);
      if (member === null) return notFound('Member');
      const today = clock.date(member.timeZone);
      const approverId = role === 'manager' ? member.managerPersonId : null;
      // T34's "If nobody decides", as HR set it.
      const rule = (await tx.settings.get('escalation')) ?? DEFAULT_ESCALATION;

      let escalatedTo = routing.escalatedTo;
      let escalated = false;
      if (escalatedTo === null && approverId !== null) {
        const approver = await tx.members.get(approverId);
        const calendar = await calendarOf(tx, approver ?? member, routing.since, today);
        const due = escalation({
          pendingSince: routing.since,
          approverManagerId: rule.to === 'hr' ? null : (approver?.managerPersonId ?? null),
          isWorkingDay: (date) => isWorkingDay(date, calendar),
          afterWorkingDays: rule.afterWorkingDays,
        });
        if (today >= due.on) {
          escalatedTo = due.to.kind === 'hr' ? 'hr' : due.to.personId;
          escalated = true;
          await tx.requests.save({ ...record, routing: { ...routing, escalatedTo } });
        }
      }

      const decider = escalatedTo ?? approverId ?? 'hr';
      if (escalated) {
        await deps.notifier.notify(
          tenantId,
          decider,
          { kind: 'approval_escalated', requestId },
          `escalated/${requestId}/${String(routing.step)}`,
        );
      }
      const at = new Date(now);
      // From the day after it started waiting: the approver was told when it was sent.
      if (today > routing.since && localMinutes(at, member.timeZone) >= rule.remindAt) {
        await deps.notifier.notify(
          tenantId,
          decider,
          { kind: 'approval_waiting', requestId, reminder: true },
          `reminder/${requestId}/${decider}/${today}`,
        );
      }
      return ok({
        open: true,
        sleepMs: msUntilLocal(at, member.timeZone, rule.remindAt),
        escalated,
      });
    });
  };
