import { err, failure, ok, type Result } from '@kithena/domain-kit';

import { decide, withdraw, type Approval } from './approval.js';

/**
 * A change to a person's record that is not applied until somebody else says
 * yes (PEO-077). The approval rules of `approval.ts`, and the two that make
 * it about a record:
 *
 * - **Only HR decides**, and HR's own change needs a second HR: the requester
 *   never decides, whatever roles they hold (`decide`).
 * - **Nobody decides a change to their own record**, even one somebody else
 *   asked for: an HR member does not approve their own pay rise because a
 *   colleague typed it.
 *
 * And the one exception to both: **the only HR member approves their own
 * change, once they confirm it** (`soleApprover`). A company whose single HR
 * holder is its first administrator would otherwise have nobody to approve
 * their own NIF, ever. Asked of who holds `hr` at decision time, so a second
 * HR member granted meanwhile closes the exception; recorded as `sole_hr`.
 *
 * A doubted national identifier is reviewed before it is approved (PEO-125):
 * while its review is open, nobody approves it.
 *
 * Pure; the caller brings the clock, says whether the decider holds `hr`, and
 * who holds it in the tenant.
 */

/** How a change was decided: by another HR member, by the only one, or by a review. */
export type DecidedAs = 'approver' | 'sole_hr' | 'identifier_review';

export interface Decided {
  readonly approval: Approval;
  readonly decidedAs: DecidedAs;
}

/** Whether `by`, the requester, is the tenant's only HR member and so may approve alone. */
export function mayApproveAlone(
  hr: readonly string[],
  change: { readonly requestedBy: string },
  by: string,
): boolean {
  return by === change.requestedBy && hr.length > 0 && hr.every((a) => a === by);
}

export function decideChange(
  approval: Approval,
  decision: {
    readonly by: string;
    readonly isHr: boolean;
    /** The account the changed record signs in as, or null for nobody yet. */
    readonly subjectAccountId: string | null;
    readonly approve: boolean;
    readonly at: string;
    readonly note?: string | null;
    /** Every account holding `hr` in the tenant, now. */
    readonly hr: readonly string[];
    /** The requester confirmed they approve it alone, as the only HR member. */
    readonly soleApprover?: boolean;
    /** Its identifier review is not accepted yet (PEO-125). */
    readonly awaitingReview?: boolean;
  },
): Result<Decided> {
  if (!decision.isHr) {
    return err(failure('FORBIDDEN', 'Only HR decides a pending change'));
  }
  const requester = decision.by === approval.requestedBy;
  const subject = decision.subjectAccountId !== null && decision.by === decision.subjectAccountId;
  if (subject && !requester) {
    return err(failure('FORBIDDEN', 'Nobody decides a change to their own record'));
  }
  const alone =
    requester &&
    decision.soleApprover === true &&
    decision.approve &&
    mayApproveAlone(decision.hr, approval, decision.by);
  if (requester && !alone) {
    return err(
      failure(
        'FORBIDDEN',
        subject
          ? 'Nobody decides a change to their own record while another HR member can'
          : 'Nobody decides their own request while another HR member can',
      ),
    );
  }
  if (decision.approve && decision.awaitingReview === true) {
    return err(
      failure('AWAITING_REVIEW', 'HR reviews this identifier before the change can be approved'),
    );
  }
  const decided = decide(approval, { ...decision, ownAllowed: alone });
  return decided.ok
    ? ok({ approval: decided.value, decidedAs: alone ? 'sole_hr' : 'approver' })
    : decided;
}

/**
 * A review found errors in the doubted identifier this change holds
 * (PEO-125): the change is declined with the reviewer's reason, which is
 * required — the employee has to know what to correct. Whoever reviewed may
 * be the requester: declining is not approving.
 */
export function declineForReview(
  approval: Approval,
  review: { readonly by: string; readonly at: string; readonly note: string | null },
): Result<Decided> {
  if ((review.note?.trim() ?? '') === '') {
    return err(failure('REASON_REQUIRED', 'Say what is wrong; the employee is shown it', ['note']));
  }
  const decided = decide(approval, { ...review, approve: false, ownAllowed: true });
  return decided.ok ? ok({ approval: decided.value, decidedAs: 'identifier_review' }) : decided;
}

/** The requester takes the change back while it waits. */
export function withdrawChange(
  approval: Approval,
  withdrawal: { readonly by: string; readonly at: string },
): Result<Approval> {
  return withdraw(approval, withdrawal);
}

/**
 * Who may decide, of the accounts holding `hr`: everybody but the requester
 * and the subject. Empty is possible — a one-person HR team changing their own
 * pay — and then only they may approve it, alone and saying so
 * (`mayApproveAlone`); nobody else is quietly let in.
 */
export function approversOf(
  hr: readonly string[],
  change: { readonly requestedBy: string; readonly subjectAccountId: string | null },
): string[] {
  return hr.filter((a) => a !== change.requestedBy && a !== change.subjectAccountId);
}
