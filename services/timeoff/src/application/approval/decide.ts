import { ok, type Result } from '@kithena/domain-kit';
import type { DateSpan, DayAmount, LeaveTypeKey, PersonId } from '@kithena/contracts';

import type { ApproverRole } from '../../domain/approval/approval-rule.js';
import { splitQueue, triage, type LookCloser, type Triage } from '../../domain/approval/triage.js';
import { workingDays } from '../../domain/calendar/working-days.js';
import { amount, days, sum, type DateRange } from '../../domain/days.js';
import type { LeaveRequest, LeaveRequestId } from '../../domain/request/leave-request.js';
import {
  contextFor,
  userActor,
  type Caller,
  type Deps,
  type Member,
  type RequestRecord,
  type Tx,
} from '../ports.js';
import { teamBelow } from '../request/assess.js';
import { jurisdictionOf, persist } from '../request/request.js';
import {
  balanceFor,
  calendarOf,
  forbidden,
  isHrAdmin,
  notFound,
  relates,
  transact,
} from '../shared.js';

/**
 * Deciding, suggesting other dates and approving in a batch (PRD §9.2–§9.5,
 * TOF-038).
 *
 * **Authorization lives here**, not in a resolver: the step waiting decides
 * who may act — `approver` or `delegate` on the member for a manager step,
 * `hr_admin` for an HR step, and whoever it was escalated to once nobody
 * decided in time. Nobody decides their own request.
 */

const WAITING: readonly LeaveRequest['status'][] = ['pending', 'change_pending'];

/** The role whose turn it is, or `null` when nothing is waiting on an approver. */
const waitingOn = (record: RequestRecord): ApproverRole | null =>
  WAITING.includes(record.request.status)
    ? (record.routing.chain[record.routing.step] ?? null)
    : null;

export async function mayDecide(
  deps: Pick<Deps, 'authz'>,
  caller: Caller,
  record: RequestRecord,
): Promise<boolean> {
  const { request, routing } = record;
  if (caller.personId === request.personId) return false;
  const role = waitingOn(record);
  if (role === null) return false;
  if (routing.escalatedTo === 'hr' || role === 'hr') return isHrAdmin(deps, caller);
  if (routing.escalatedTo !== null && caller.personId === routing.escalatedTo) return true;
  return (
    (await relates(deps, caller, 'approver', request.personId)) ||
    relates(deps, caller, 'delegate', request.personId)
  );
}

type DecideDeps = Pick<Deps, 'uow' | 'authz' | 'clock' | 'newId' | 'timers'>;

async function load(
  tx: Tx,
  deps: Pick<Deps, 'authz'>,
  caller: Caller,
  requestId: LeaveRequestId,
): Promise<Result<{ record: RequestRecord; member: Member }>> {
  const record = await tx.requests.get(requestId);
  if (record === null) return notFound('Request');
  if (!(await mayDecide(deps, caller, record))) return forbidden();
  const member = await tx.members.get(record.request.personId);
  if (member === null) return notFound('Member');
  return ok({ record, member });
}

export interface Decided {
  readonly requestId: LeaveRequestId;
  readonly status: LeaveRequest['status'];
  /** The next role in the chain when this was not the last step. */
  readonly next: ApproverRole | null;
}

/** One approval at the step waiting: the next step's turn, or the request approved. */
async function approveIn(
  tx: Tx,
  deps: DecideDeps,
  caller: Caller,
  record: RequestRecord,
  member: Member,
): Promise<Result<Decided>> {
  const { request, routing } = record;
  const next = routing.chain[routing.step + 1] ?? null;
  if (next !== null) {
    await tx.requests.save({
      ...record,
      routing: {
        ...routing,
        step: routing.step + 1,
        since: deps.clock.date(member.timeZone),
        escalatedTo: null,
      },
    });
    return ok({ requestId: request.id, status: request.status, next });
  }
  const ctx = contextFor(deps, userActor(caller), caller.correlationId, member.timeZone);
  const entries =
    request.status === 'change_pending'
      ? request.approveChange(ctx)
      : request.approve({ by: caller.accountId, jurisdiction: jurisdictionOf(member) }, ctx);
  if (!entries.ok) return entries;
  const saved = await persist(tx, record, entries.value);
  if (!saved.ok) return saved;
  return ok({ requestId: request.id, status: request.status, next: null });
}

/** Approve or decline one request, or the change to one (§9.4). */
export const decideRequest =
  (deps: DecideDeps) =>
  async (
    caller: Caller,
    input: {
      readonly requestId: LeaveRequestId;
      readonly decision: 'approve' | 'decline';
      readonly reason?: string | null;
    },
  ): Promise<Result<Decided>> => {
    const decided = await transact<Decided>(deps, caller.tenantId, async (tx) => {
      const found = await load(tx, deps, caller, input.requestId);
      if (!found.ok) return found;
      const { record, member } = found.value;
      if (input.decision === 'approve') return approveIn(tx, deps, caller, record, member);

      const ctx = contextFor(deps, userActor(caller), caller.correlationId, member.timeZone);
      const { request } = record;
      const entries =
        request.status === 'change_pending'
          ? request.declineChange(ctx)
          : request.decline({ by: caller.accountId, reason: input.reason ?? null }, ctx);
      if (!entries.ok) return entries;
      const saved = await persist(tx, record, entries.value);
      if (!saved.ok) return saved;
      return ok({ requestId: request.id, status: request.status, next: null });
    });
    if (decided.ok && decided.value.next === null) {
      await deps.timers.closed(caller.tenantId, input.requestId);
    }
    return decided;
  };

/** Other dates instead of a decline (§9.5): runs of days, each costed on the member's calendar. */
export const counterPropose =
  (deps: DecideDeps) =>
  async (
    caller: Caller,
    input: {
      readonly requestId: LeaveRequestId;
      readonly proposals: readonly { readonly spans: readonly DateRange[] }[];
    },
  ): Promise<Result<{ status: LeaveRequest['status'] }>> => {
    const done = await transact(deps, caller.tenantId, async (tx) => {
      const found = await load(tx, deps, caller, input.requestId);
      if (!found.ok) return found;
      const { record, member } = found.value;
      const proposals = await Promise.all(
        input.proposals.map(async (p) => {
          const first = p.spans[0]?.from ?? record.request.span.from;
          const last = p.spans.at(-1)?.to ?? first;
          const calendar = await calendarOf(tx, member, first, last);
          const cost = sum(
            p.spans.map((r) =>
              days(workingDays({ ...r, startsHalfDay: false, endsHalfDay: false }, calendar)),
            ),
          );
          return { spans: p.spans, workingDays: amount(cost) };
        }),
      );
      const ctx = contextFor(deps, userActor(caller), caller.correlationId, member.timeZone);
      const entries = record.request.counterPropose({ by: caller.accountId, proposals }, ctx);
      if (!entries.ok) return entries;
      const saved = await persist(tx, { ...record, proposedBy: caller.accountId }, entries.value);
      if (!saved.ok) return saved;
      return ok({ status: record.request.status });
    });
    // The request now waits on its member, not an approver.
    if (done.ok) await deps.timers.closed(caller.tenantId, input.requestId);
    return done;
  };

/** The member's answer to a counter-proposal: one tap accepts it, and approves it (§9.5). */
export const answerCounter =
  (deps: DecideDeps) =>
  async (
    caller: Caller,
    input: { readonly requestId: LeaveRequestId; readonly accept: number | null },
  ): Promise<Result<{ status: LeaveRequest['status'] }>> => {
    const done = await transact(deps, caller.tenantId, async (tx) => {
      const record = await tx.requests.get(input.requestId);
      if (record === null) return notFound('Request');
      if (caller.personId !== record.request.personId) return forbidden();
      const member = await tx.members.get(record.request.personId);
      if (member === null) return notFound('Member');
      const ctx = contextFor(deps, userActor(caller), caller.correlationId, member.timeZone);
      const today = deps.clock.date(member.timeZone);
      const entries =
        input.accept === null
          ? record.request.keepOwnDates(ctx)
          : record.request.acceptCounter(
              {
                index: input.accept,
                approvedBy: record.proposedBy ?? caller.accountId,
                jurisdiction: jurisdictionOf(member),
              },
              ctx,
            );
      if (!entries.ok) return entries;
      const routing =
        input.accept === null
          ? { ...record.routing, since: today, escalatedTo: null }
          : record.routing;
      const saved = await persist(tx, { ...record, routing }, entries.value);
      if (!saved.ok) return saved;
      return ok({ status: record.request.status });
    });
    // Kept their own dates: back to the approver, and the clock starts again.
    if (done.ok && done.value.status === 'pending') {
      await deps.timers.started(caller.tenantId, input.requestId, caller.correlationId);
    }
    return done;
  };

/* ----------------------------------------------------------------- queue -- */

export interface QueueItem {
  readonly requestId: LeaveRequestId;
  readonly personId: PersonId;
  readonly displayName: string;
  readonly leaveTypeKey: LeaveTypeKey;
  readonly status: LeaveRequest['status'];
  readonly span: DateSpan;
  readonly workingDays: DayAmount;
}

/** Triage one request as the queue sees it: balance before it, coverage with it. */
export async function triageOf(
  tx: Tx,
  deps: Pick<Deps, 'clock'>,
  record: RequestRecord,
  member: Member,
): Promise<Triage> {
  const { request } = record;
  const span =
    request.status === 'change_pending' ? (request.pendingChange ?? request.span) : request.span;
  const today = deps.clock.date(member.timeZone);
  const left = request.leaveType.tracked
    ? (await balanceFor(tx, member, request.leaveType.key, today, request.id)).left
    : null;
  const below = await teamBelow(
    tx,
    member,
    span.from,
    span.to,
    [{ personId: member.personId, span, status: 'pending' }],
    request.id,
  );
  const auto = await tx.approvals.autoApproval();
  return triage(
    {
      category: request.leaveType.category,
      unit: request.leaveType.unit,
      cost: span.workingDays,
      left,
      daysBelowMinimum: below.map((d) => d.date),
    },
    { sickUnderDays: auto.sickUnderDays ?? 3 },
  );
}

/**
 * "Waiting for me" (§9.2), split into Clear to approve and Look closer by
 * the domain's rule, each in the order it was asked.
 *
 * ponytail: reads every waiting request in the tenant and asks about each;
 * a `waiting_on` column on the request table is the upgrade when a tenant's
 * queue is large.
 */
export const approvalQueue =
  (deps: Pick<Deps, 'uow' | 'authz' | 'clock'>) =>
  (
    caller: Caller,
  ): Promise<
    Result<{ clear: QueueItem[]; lookCloser: { item: QueueItem; reason: LookCloser }[] }>
  > =>
    transact(deps, caller.tenantId, async (tx) => {
      const waiting = (await tx.requests.list({ statuses: WAITING })).toSorted((a, b) =>
        a.requestedAt.localeCompare(b.requestedAt),
      );
      const mine: { item: QueueItem; triage: Triage }[] = [];
      for (const record of waiting) {
        if (!(await mayDecide(deps, caller, record))) continue;
        const member = await tx.members.get(record.request.personId);
        if (member === null) continue;
        const { request } = record;
        const span = request.pendingChange ?? request.span;
        mine.push({
          item: {
            requestId: request.id,
            personId: request.personId,
            displayName: member.displayName,
            leaveTypeKey: request.leaveType.key,
            status: request.status,
            span: {
              from: span.from,
              to: span.to,
              startsHalfDay: span.startsHalfDay,
              endsHalfDay: span.endsHalfDay,
            },
            workingDays: span.workingDays,
          },
          triage: await triageOf(tx, deps, record, member),
        });
      }
      const split = splitQueue(mine, (m) => m.triage);
      return ok({
        clear: split.clear.map((m) => m.item),
        lookCloser: split.lookCloser.map((l) => ({ item: l.item.item, reason: l.reason })),
      });
    });

export interface Batch {
  readonly approved: readonly Decided[];
  readonly refused: readonly {
    readonly requestId: LeaveRequestId;
    readonly code: string;
    readonly reason: LookCloser | null;
  }[];
}

/**
 * Approve several at once — only the ones triage calls clear (§9.2). Each is
 * triaged again here rather than trusted from the screen, because the team
 * may have changed since the queue was read; a look-closer one is refused
 * with its reason and left waiting.
 */
export const batchApprove =
  (deps: DecideDeps) =>
  async (caller: Caller, requestIds: readonly LeaveRequestId[]): Promise<Result<Batch>> => {
    const batch = await transact<Batch>(deps, caller.tenantId, async (tx) => {
      const approved: Decided[] = [];
      const refused: Batch['refused'][number][] = [];
      for (const requestId of requestIds) {
        const found = await load(tx, deps, caller, requestId);
        if (!found.ok) {
          refused.push({ requestId, code: found.error.code, reason: null });
          continue;
        }
        const { record, member } = found.value;
        const verdict = await triageOf(tx, deps, record, member);
        if (verdict.group === 'look_closer') {
          refused.push({ requestId, code: 'LOOK_CLOSER', reason: verdict.reason });
          continue;
        }
        const done = await approveIn(tx, deps, caller, record, member);
        if (!done.ok) return done;
        approved.push(done.value);
      }
      return ok({ approved, refused });
    });
    if (batch.ok) {
      for (const d of batch.value.approved) {
        if (d.next === null) await deps.timers.closed(caller.tenantId, d.requestId);
      }
    }
    return batch;
  };
