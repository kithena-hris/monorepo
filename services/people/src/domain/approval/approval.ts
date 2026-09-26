import { err, failure, ok, type Result } from '@kithena/domain-kit';

/**
 * A request somebody else must decide, and a thing it grants that can be used
 * exactly once (PEO-088; the primitives PEO-077's approval workflows reuse).
 *
 * Nothing here knows what is being approved. An approval is who asked, why,
 * until when, and who decided; a grant is when it was issued, until when, and
 * whether it has been used. The rules are the ones every approval shares:
 *
 * - **A reason is stated up front**, because an approval with no reason is a
 *   rubber stamp and an audit trail with no reason explains nothing.
 * - **Nobody approves their own request**, whatever their roles. Separation
 *   of duties is the point of asking.
 * - **A decision is final**, and one arriving after the request expired is
 *   refused rather than quietly applied to a request nobody is waiting on.
 * - **Pending past its deadline is expired**, even before anything has
 *   written that down: the answer is a function of the clock, not of whether
 *   a timer has fired yet.
 *
 * Pure: instants in, `Result` out. The caller brings the clock.
 */

export type ApprovalState = 'pending' | 'approved' | 'rejected' | 'expired' | 'withdrawn';

export interface Approval {
  readonly id: string;
  readonly requestedBy: string;
  readonly requestedAt: string;
  readonly reason: string;
  readonly expiresAt: string;
  readonly state: ApprovalState;
  readonly decidedBy: string | null;
  readonly decidedAt: string | null;
  readonly note: string | null;
}

export const REASON_MAX = 500;

const before = (a: string, b: string) => Date.parse(a) < Date.parse(b);

export function openApproval(input: {
  readonly id: string;
  readonly requestedBy: string;
  readonly reason: string | null | undefined;
  readonly at: string;
  /** Decided by the caller, which owns the clock and the policy for how long. */
  readonly expiresAt: string;
  /**
   * A request nobody typed (PEO-077): a held form edit or an import row asks
   * no question, so there is nothing to require. Still bounded when given.
   * The reason is then `''`.
   */
  readonly reasonOptional?: boolean;
}): Result<Approval> {
  const reason = input.reason?.trim() ?? '';
  if (reason === '' && input.reasonOptional !== true) {
    return err(failure('REASON_REQUIRED', 'Say why; it is recorded with the request', ['reason']));
  }
  if (reason.length > REASON_MAX) {
    return err(
      failure('VALUE_INVALID', `A reason is at most ${String(REASON_MAX)} characters`, ['reason']),
    );
  }
  if (!before(input.at, input.expiresAt)) {
    return err(failure('VALUE_INVALID', 'A request must expire after it is made'));
  }
  return ok({
    id: input.id,
    requestedBy: input.requestedBy,
    requestedAt: input.at,
    reason,
    expiresAt: input.expiresAt,
    state: 'pending',
    decidedBy: null,
    decidedAt: null,
    note: null,
  });
}

/** What the request is at `at`: pending past its deadline reads as expired. */
export function stateAt(approval: Approval, at: string): ApprovalState {
  return approval.state === 'pending' && !before(at, approval.expiresAt)
    ? 'expired'
    : approval.state;
}

export function decide(
  approval: Approval,
  decision: {
    readonly by: string;
    readonly approve: boolean;
    readonly at: string;
    readonly note?: string | null;
  },
): Result<Approval> {
  const state = stateAt(approval, decision.at);
  if (state === 'expired') {
    return err(failure('APPROVAL_EXPIRED', 'This request expired before it was decided'));
  }
  if (state !== 'pending') {
    return err(failure('APPROVAL_DECIDED', `This request was already ${state}`));
  }
  if (decision.by === approval.requestedBy) {
    return err(failure('FORBIDDEN', 'Nobody decides their own request'));
  }
  const note = decision.note?.trim() ?? '';
  if (note.length > REASON_MAX) {
    return err(
      failure('VALUE_INVALID', `A note is at most ${String(REASON_MAX)} characters`, ['note']),
    );
  }
  return ok({
    ...approval,
    state: decision.approve ? 'approved' : 'rejected',
    decidedBy: decision.by,
    decidedAt: decision.at,
    note: note === '' ? null : note,
  });
}

/** Record that a pending request ran out of time. Refused while it still has some. */
export function expire(approval: Approval, at: string): Result<Approval> {
  if (approval.state !== 'pending') {
    return err(failure('APPROVAL_DECIDED', `This request was already ${approval.state}`));
  }
  if (before(at, approval.expiresAt)) {
    return err(failure('APPROVAL_PENDING', 'This request has not expired yet'));
  }
  return ok({ ...approval, state: 'expired' });
}

/**
 * The requester takes their own request back (PEO-077). Only theirs, only
 * while it is still pending: a decision or an expiry is already an answer.
 * Recorded like a decision — who and when — because it closes the request.
 */
export function withdraw(
  approval: Approval,
  withdrawal: { readonly by: string; readonly at: string },
): Result<Approval> {
  const state = stateAt(approval, withdrawal.at);
  if (state === 'expired') {
    return err(failure('APPROVAL_EXPIRED', 'This request expired before it was withdrawn'));
  }
  if (state !== 'pending') {
    return err(failure('APPROVAL_DECIDED', `This request was already ${state}`));
  }
  if (withdrawal.by !== approval.requestedBy) {
    return err(failure('FORBIDDEN', 'Only whoever asked withdraws a request'));
  }
  return ok({ ...approval, state: 'withdrawn', decidedBy: withdrawal.by, decidedAt: withdrawal.at });
}

/** Something an approval issued that may be used once, until it expires. */
export interface Grant {
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly usedAt: string | null;
}

export function useOnce(grant: Grant, at: string): Result<Grant> {
  if (grant.usedAt !== null) {
    return err(failure('GRANT_USED', 'This was already used; ask again'));
  }
  if (!before(at, grant.expiresAt)) {
    return err(failure('GRANT_EXPIRED', 'This has expired; ask again'));
  }
  return ok({ ...grant, usedAt: at });
}
