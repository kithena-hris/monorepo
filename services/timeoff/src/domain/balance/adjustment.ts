import { err, failure, Forbidden, ok, type Result } from '@kithena/domain-kit';
import type { CalendarDate, DayAmount, LeaveTypeKey, PersonId } from '@kithena/contracts';

import type { EventContext } from '../context.js';
import { amount, days } from '../days.js';

/**
 * Adding to or taking from a balance by hand (PRD §7.1's `adjustment`): HR's
 * goes into the ledger as it is made; a manager's waits for HR to approve it.
 * Either way it says why, and the reason is what the person sees beside it.
 *
 * Nobody decides their own: HR adjusting their own balance waits for another
 * HR administrator, and the one who asked never approves it.
 */

export type AdjustmentStatus = 'pending' | 'approved' | 'declined';

export interface Adjustment {
  readonly adjustmentId: string;
  readonly personId: PersonId;
  readonly leaveTypeKey: LeaveTypeKey;
  /** Days, or hours for an hour-unit type: positive adds, negative takes away. */
  readonly amount: DayAmount;
  readonly effectiveOn: CalendarDate;
  readonly reason: string;
  /** The account that asked for it. */
  readonly proposedBy: string;
  readonly proposedAt: string;
  readonly status: AdjustmentStatus;
  readonly decidedBy: string | null;
  readonly decidedAt: string | null;
  /** Why it was declined, when HR said. */
  readonly note: string | null;
}

/** The longest reason kept: a sentence or two, not a document. */
const REASON_MAX = 500;

export function proposeAdjustment(
  input: {
    readonly personId: PersonId;
    readonly leaveTypeKey: LeaveTypeKey;
    readonly amount: DayAmount | string;
    readonly effectiveOn: CalendarDate;
    readonly reason: string;
    readonly proposedBy: string;
    /** HR, and not adjusting their own balance: approved as it is made. */
    readonly byHr: boolean;
  },
  ctx: Pick<EventContext, 'newId' | 'clock'>,
): Result<Adjustment> {
  const reason = input.reason.trim();
  if (reason === '') {
    return err(failure('REASON_REQUIRED', 'An adjustment always says why', ['reason']));
  }
  if (reason.length > REASON_MAX) {
    return err(failure('REASON_TOO_LONG', 'Keep the reason to a sentence or two', ['reason']));
  }
  if (days(input.amount).isZero()) {
    return err(failure('NOTHING_TO_ADJUST', 'Add or take away at least some time', ['amount']));
  }
  const at = ctx.clock.instant();
  return ok({
    adjustmentId: ctx.newId(),
    personId: input.personId,
    leaveTypeKey: input.leaveTypeKey,
    amount: amount(input.amount),
    effectiveOn: input.effectiveOn,
    reason,
    proposedBy: input.proposedBy,
    proposedAt: at,
    status: input.byHr ? 'approved' : 'pending',
    decidedBy: input.byHr ? input.proposedBy : null,
    decidedAt: input.byHr ? at : null,
    note: null,
  });
}

export function decideAdjustment(
  adjustment: Adjustment,
  decision: { readonly approve: boolean; readonly by: string; readonly note?: string | null },
  ctx: Pick<EventContext, 'clock'>,
): Result<Adjustment> {
  if (adjustment.status !== 'pending') {
    return err(failure('ALREADY_DECIDED', 'This adjustment was already decided'));
  }
  if (decision.by === adjustment.proposedBy) return err(Forbidden());
  const note = decision.note?.trim() ?? '';
  return ok({
    ...adjustment,
    status: decision.approve ? 'approved' : 'declined',
    decidedBy: decision.by,
    decidedAt: ctx.clock.instant(),
    note: note === '' ? null : note,
  });
}
