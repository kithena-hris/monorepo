import { err, failure, type Result } from '@kithena/domain-kit';

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
 * Pure; the caller brings the clock and says whether the decider holds `hr`.
 */

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
  },
): Result<Approval> {
  if (!decision.isHr) {
    return err(failure('FORBIDDEN', 'Only HR decides a pending change'));
  }
  if (decision.subjectAccountId !== null && decision.by === decision.subjectAccountId) {
    return err(failure('FORBIDDEN', 'Nobody decides a change to their own record'));
  }
  return decide(approval, decision);
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
 * pay — and then the change waits until it expires; nobody is quietly let in.
 */
export function approversOf(
  hr: readonly string[],
  change: { readonly requestedBy: string; readonly subjectAccountId: string | null },
): string[] {
  return hr.filter((a) => a !== change.requestedBy && a !== change.subjectAccountId);
}
