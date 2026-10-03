import { err, failure, ok, type Result } from '@kithena/domain-kit';
import type { LeaveTypeDefinition, PersonId, TenantId } from '@kithena/contracts';

import type { LedgerEntry } from '../balance/ledger.js';
import type { EventContext } from '../context.js';
import { days } from '../days.js';
import { LeaveRequest, type LeaveRequestId, type RequestLeaveType, type Span } from './leave-request.js';

/**
 * Sick leave: tell, don't ask (PRD §8.5).
 *
 * Recorded on the day and informing the manager, approved on creation under
 * the threshold (default under 3 days), and asking for a note once it runs
 * past the leave type's `requiresNote`. The note is health data: the
 * aggregate holds its file id, and every event says only `notePresent`.
 */

export type SickLeaveType = RequestLeaveType & Pick<LeaveTypeDefinition, 'requiresNote'>;

export function recordSick(
  args: {
    id: LeaveRequestId;
    tenantId: TenantId;
    personId: PersonId;
    leaveType: SickLeaveType;
    span: Span;
    sickNoteFileId: string | null;
    /** Approved automatically under this many days (T34); `null` when switched off. */
    autoApproveUnderDays?: number | null;
    /** The account recording it, who is also the approver of record when it is automatic. */
    recordedBy: string;
    jurisdiction: string;
  },
  ctx: EventContext,
): Result<{ request: LeaveRequest; entries: readonly LedgerEntry[]; noteRequired: boolean }> {
  if (args.leaveType.category !== 'sick_leave') {
    return err(failure('NOT_SICK_LEAVE', 'Only sick leave is recorded rather than requested', ['leaveTypeKey']));
  }
  const created = LeaveRequest.request(
    {
      id: args.id,
      tenantId: args.tenantId,
      personId: args.personId,
      leaveType: args.leaveType,
      span: args.span,
      verdict: { kind: 'fits' },
      sickNoteFileId: args.sickNoteFileId,
    },
    ctx,
  );
  if (!created.ok) return created;
  const { request, entries } = created.value;

  const cost = days(args.span.workingDays);
  const threshold = args.autoApproveUnderDays === undefined ? 3 : args.autoApproveUnderDays;
  if (threshold !== null && cost.lt(threshold)) {
    const approved = request.approve({ by: args.recordedBy, jurisdiction: args.jurisdiction }, ctx);
    if (!approved.ok) return approved;
  }
  const afterDays = args.leaveType.requiresNote?.afterDays;
  const noteRequired = afterDays !== undefined && cost.gt(afterDays) && args.sickNoteFileId === null;
  return ok({ request, entries, noteRequired });
}
