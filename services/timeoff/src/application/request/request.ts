import { ok, type Result } from '@kithena/domain-kit';
import type {
  CalendarDate,
  DateSpan,
  DayAmount,
  LedgerEntry,
  LeaveTypeKey,
  PersonId,
} from '@kithena/contracts';

import { workingDays } from '../../domain/calendar/working-days.js';
import { amount, days, sum } from '../../domain/days.js';
import {
  LeaveRequest,
  leaveRequestId,
  type LeaveRequestId,
} from '../../domain/request/leave-request.js';
import { recordSick } from '../../domain/request/sick.js';
import {
  contextFor,
  userActor,
  type Caller,
  type Deps,
  type Member,
  type RequestRecord,
  type Tx,
} from '../ports.js';
import { calendarOf, forbidden, notFound, post, refuse, selfOrHr, transact } from '../shared.js';
import { assess, LIVE, type Assessment } from './assess.js';

/**
 * Requesting, changing and cancelling (PRD §8.2–§8.5, TOF-037).
 *
 * Each use case loads what the aggregate needs — policy, ledger, holidays,
 * coverage — calls it, then saves the request, its ledger rows and its events
 * in one transaction. The escalation timer starts after that commits, so a
 * rolled-back request never has a clock running.
 */

export interface RequestInput {
  readonly leaveTypeKey: LeaveTypeKey;
  readonly span: DateSpan;
  readonly note?: string | null;
  readonly sickNoteFileId?: string | null;
}

/** ISO 3166-1 alpha-2 for whose rules apply; `ZZ` when the member's country is not known. */
export const jurisdictionOf = (member: Member): string => member.country ?? 'ZZ';

/** The request panel's consequences (§8.2), without saving anything. */
export type Preview = Omit<Assessment, 'member' | 'leaveType' | 'calendar' | 'policyVersion'>;

const preview = (a: Assessment): Preview => ({
  span: a.span,
  daysAway: a.daysAway,
  balance: a.balance,
  belowMinimum: a.belowMinimum,
  blocked: a.blocked,
  negative: a.negative,
  approvers: a.approvers,
  approver: a.approver,
});

async function self(tx: Tx, caller: Caller): Promise<Result<Member>> {
  if (caller.personId === null) return forbidden();
  const member = await tx.members.get(caller.personId);
  return member === null ? notFound('Member') : ok(member);
}

async function overlaps(
  tx: Tx,
  personId: PersonId,
  from: CalendarDate,
  to: CalendarDate,
  excluding: string | null,
): Promise<boolean> {
  const live = await tx.requests.list({ personIds: [personId], statuses: LIVE, from, to });
  return live.some((r) => r.request.id !== excluding);
}

export const previewRequest =
  (deps: Pick<Deps, 'uow' | 'clock'>) =>
  (caller: Caller, input: RequestInput): Promise<Result<Preview>> =>
    transact(deps, caller.tenantId, async (tx) => {
      const member = await self(tx, caller);
      if (!member.ok) return member;
      const assessed = await assess(tx, {
        member: member.value,
        leaveTypeKey: input.leaveTypeKey,
        span: input.span,
        action: 'request',
        today: deps.clock.date(member.value.timeZone),
      });
      return assessed.ok ? ok(preview(assessed.value)) : assessed;
    });

export interface Sent {
  readonly requestId: LeaveRequestId;
  readonly status: LeaveRequest['status'];
  readonly preview: Preview;
  /** Sick leave past the type's note threshold, sent without one. */
  readonly noteRequired: boolean;
}

/** Save a record, its rows and its events, in the caller's transaction. */
export async function persist(
  tx: Tx,
  record: RequestRecord,
  entries: readonly LedgerEntry[],
): Promise<Result<void>> {
  const posted = await post(tx, entries);
  if (!posted.ok) return posted;
  await tx.requests.save(record);
  await tx.outbox.publish(record.request.drainEvents());
  return ok(undefined);
}

export const sendRequest =
  (deps: Pick<Deps, 'uow' | 'clock' | 'newId' | 'timers'>) =>
  async (caller: Caller, input: RequestInput): Promise<Result<Sent>> => {
    const sent = await transact<Sent>(deps, caller.tenantId, async (tx) => {
      const found = await self(tx, caller);
      if (!found.ok) return found;
      const member = found.value;
      const today = deps.clock.date(member.timeZone);
      const assessed = await assess(tx, {
        member,
        leaveTypeKey: input.leaveTypeKey,
        span: input.span,
        action: 'request',
        today,
      });
      if (!assessed.ok) return assessed;
      const a = assessed.value;
      if (a.blocked) {
        return refuse(
          'BELOW_TEAM_MINIMUM',
          'The team would fall below its minimum on these dates',
          ['span'],
        );
      }
      if (await overlaps(tx, member.personId, a.span.from, a.span.to, null)) {
        return refuse('OVERLAP', 'You already have time off on some of these dates', ['span']);
      }

      const ctx = contextFor(deps, userActor(caller), caller.correlationId, member.timeZone);
      const id = leaveRequestId(deps.newId());
      const common = {
        id,
        tenantId: caller.tenantId,
        personId: member.personId,
        span: a.span,
      };
      const auto = await tx.approvals.autoApproval();
      const created =
        a.leaveType.definition.category === 'sick_leave'
          ? recordSick(
              {
                ...common,
                leaveType: a.leaveType.definition,
                sickNoteFileId: input.sickNoteFileId ?? null,
                autoApproveUnderDays: auto.sickUnderDays,
                recordedBy: caller.accountId,
                jurisdiction: jurisdictionOf(member),
              },
              ctx,
            )
          : LeaveRequest.request(
              {
                ...common,
                leaveType: a.leaveType.definition,
                verdict: a.negative.verdict,
                sickNoteFileId: input.sickNoteFileId ?? null,
              },
              ctx,
            );
      if (!created.ok) return created;
      const { request, entries } = created.value;
      if (request.status === 'pending' && a.approvers.length === 0) {
        const approved = request.approve(
          { by: caller.accountId, jurisdiction: jurisdictionOf(member) },
          ctx,
        );
        if (!approved.ok) return approved;
      }

      const saved = await persist(
        tx,
        {
          request,
          routing: { chain: a.approvers, step: 0, since: today, escalatedTo: null },
          note: input.note ?? null,
          requestedAt: deps.clock.instant(),
          proposedBy: null,
        },
        entries,
      );
      if (!saved.ok) return saved;
      return ok({
        requestId: id,
        status: request.status,
        preview: preview(a),
        noteRequired: 'noteRequired' in created.value && created.value.noteRequired === true,
      });
    });
    if (sent.ok && sent.value.status === 'pending') {
      await deps.timers.started(caller.tenantId, sent.value.requestId, caller.correlationId);
    }
    return sent;
  };

/** A request the caller may act on as its member (or as HR), with that member. */
async function own(
  tx: Tx,
  deps: Pick<Deps, 'authz'>,
  caller: Caller,
  requestId: LeaveRequestId,
): Promise<Result<{ record: RequestRecord; member: Member }>> {
  const record = await tx.requests.get(requestId);
  if (record === null) return notFound('Request');
  if (!(await selfOrHr(deps, caller, record.request.personId))) return forbidden();
  const member = await tx.members.get(record.request.personId);
  if (member === null) return notFound('Member');
  return ok({ record, member });
}

/**
 * Move approved dates (§8.4). The old ones stay booked until the new ones are
 * approved; a change the rules approve automatically moves at once.
 */
export const changeRequest =
  (deps: Pick<Deps, 'uow' | 'authz' | 'clock' | 'newId' | 'timers'>) =>
  async (
    caller: Caller,
    input: { readonly requestId: LeaveRequestId; readonly span: DateSpan },
  ): Promise<Result<{ status: LeaveRequest['status']; preview: Preview }>> => {
    const changed = await transact(deps, caller.tenantId, async (tx) => {
      const found = await own(tx, deps, caller, input.requestId);
      if (!found.ok) return found;
      const { record, member } = found.value;
      const today = deps.clock.date(member.timeZone);
      const assessed = await assess(tx, {
        member,
        leaveTypeKey: record.request.leaveType.key,
        span: input.span,
        action: 'change',
        today,
        excluding: record,
      });
      if (!assessed.ok) return assessed;
      const a = assessed.value;
      if (a.negative.verdict.kind === 'refused') {
        return refuse(
          'BEYOND_NEGATIVE_LIMIT',
          `This goes further below zero than the ${a.negative.verdict.limit} days allowed`,
          ['span'],
        );
      }
      if (a.blocked) {
        return refuse(
          'BELOW_TEAM_MINIMUM',
          'The team would fall below its minimum on these dates',
          ['span'],
        );
      }
      if (await overlaps(tx, member.personId, a.span.from, a.span.to, record.request.id)) {
        return refuse('OVERLAP', 'You already have time off on some of these dates', ['span']);
      }
      const ctx = contextFor(deps, userActor(caller), caller.correlationId, member.timeZone);
      const asked = record.request.requestChange({ span: a.span }, ctx);
      if (!asked.ok) return asked;
      const moved = a.approvers.length === 0 ? record.request.approveChange(ctx) : ok([]);
      if (!moved.ok) return moved;
      const saved = await persist(
        tx,
        { ...record, routing: { chain: a.approvers, step: 0, since: today, escalatedTo: null } },
        moved.value,
      );
      if (!saved.ok) return saved;
      return ok({ status: record.request.status, preview: preview(a) });
    });
    if (changed.ok && changed.value.status === 'change_pending') {
      await deps.timers.started(caller.tenantId, input.requestId, caller.correlationId);
    }
    return changed;
  };

/** Give the tail back (§8.4). Approved automatically, because it only returns time. */
export const shortenRequest =
  (deps: Pick<Deps, 'uow' | 'authz' | 'clock' | 'newId'>) =>
  (
    caller: Caller,
    input: {
      readonly requestId: LeaveRequestId;
      readonly to: CalendarDate;
      readonly endsHalfDay: boolean;
    },
  ): Promise<Result<{ releasedDays: DayAmount }>> =>
    transact(deps, caller.tenantId, async (tx) => {
      const found = await own(tx, deps, caller, input.requestId);
      if (!found.ok) return found;
      const { record, member } = found.value;
      const { span } = record.request;
      const calendar = await calendarOf(tx, member, span.from, input.to);
      const cost = workingDays(
        {
          from: span.from,
          to: input.to,
          startsHalfDay: span.startsHalfDay,
          endsHalfDay: input.endsHalfDay,
        },
        calendar,
      );
      const ctx = contextFor(deps, userActor(caller), caller.correlationId, member.timeZone);
      const shortened = record.request.shorten(
        { to: input.to, endsHalfDay: input.endsHalfDay, workingDays: cost },
        ctx,
      );
      if (!shortened.ok) return shortened;
      const saved = await persist(tx, record, shortened.value);
      if (!saved.ok) return saved;
      return ok({ releasedDays: amount(sum(shortened.value.map((e) => days(e.amount)))) });
    });

/**
 * Cancel (§8.4): an approved request is cancelled and its days return at once;
 * one nobody has decided yet is withdrawn.
 */
export const cancelRequest =
  (deps: Pick<Deps, 'uow' | 'authz' | 'clock' | 'newId' | 'timers'>) =>
  async (
    caller: Caller,
    requestId: LeaveRequestId,
  ): Promise<Result<{ status: LeaveRequest['status'] }>> => {
    const done = await transact(deps, caller.tenantId, async (tx) => {
      const found = await own(tx, deps, caller, requestId);
      if (!found.ok) return found;
      const { record, member } = found.value;
      const ctx = contextFor(deps, userActor(caller), caller.correlationId, member.timeZone);
      const before = record.request.status;
      const undecided = before === 'pending' || before === 'counter_proposed';
      const entries = undecided ? record.request.withdraw(ctx) : record.request.cancel(ctx);
      if (!entries.ok) return entries;
      const saved = await persist(tx, record, entries.value);
      if (!saved.ok) return saved;
      return ok({
        status: record.request.status,
        wasWaiting: undecided || before === 'change_pending',
      });
    });
    if (!done.ok) return done;
    if (done.value.wasWaiting) await deps.timers.closed(caller.tenantId, requestId);
    return ok({ status: done.value.status });
  };
