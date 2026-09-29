import { ok, type Clock, type Result } from '@kithena/domain-kit';

import { viewAsReason, viewAsRefusal, viewAsWindow, type ViewAsParty } from '../domain/view-as.js';
import type { IssueHandoff } from './handoff.js';

/**
 * A People administrator starts viewing the app as one employee.
 *
 * People asks, over its own internal token, once it has decided the asker is
 * a `people_admin` and the employee is not an administrator — it holds the
 * roles, identity does not. What identity keeps whatever People says is in
 * `viewAsRefusal`: two active people of this company, never oneself, never
 * Kithena support, never from inside another view.
 *
 * The session, its `platform.view_as_access` row and its
 * `identity.view_as.started` event are one transaction: a session that exists
 * was audited. The answer is a handoff code, redeemed by the tenant app's
 * server, which is the only party that ever holds the session id.
 */

export interface ViewAsStart {
  readonly tenantId: string;
  readonly adminAccountId: string;
  readonly subjectAccountId: string;
  readonly reason: string;
  readonly specialCategory: boolean;
  readonly sessionId: string;
  readonly startedAt: string;
  readonly expiresAt: string;
}

export interface StartViewAsDeps {
  /**
   * In one tenant transaction: read both accounts and whether the admin's own
   * account is being viewed, ask `check`, and only if it agrees write the
   * session, the record and the event.
   */
  readonly begin: (
    input: ViewAsStart,
    check: (parties: {
      readonly admin: ViewAsParty | null;
      readonly subject: ViewAsParty | null;
      readonly adminBeingViewed: boolean;
    }) => Result<void>,
  ) => Promise<Result<void>>;
  readonly issueHandoff: IssueHandoff;
  readonly clock: Clock;
  readonly newId: () => string;
}

export type StartViewAs = (input: {
  readonly tenantId: string;
  readonly adminAccountId: string;
  readonly subjectAccountId: string;
  readonly reason: unknown;
  readonly specialCategory: boolean;
}) => Promise<Result<{ code: string; expiresAt: string }>>;

export function startViewAs(deps: StartViewAsDeps): StartViewAs {
  return async (input) => {
    const reason = viewAsReason(input.reason);
    if (!reason.ok) return reason;

    const sessionId = deps.newId();
    const window = viewAsWindow(deps.clock.now());
    const begun = await deps.begin(
      { ...input, reason: reason.value, sessionId, ...window },
      viewAsRefusal,
    );
    if (!begun.ok) return begun;

    const issued = await deps.issueHandoff({ tenantId: input.tenantId, sessionId });
    if (!issued.ok) return issued;
    return ok({ code: issued.value.code, expiresAt: window.expiresAt });
  };
}
