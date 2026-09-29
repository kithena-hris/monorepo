import { err, failure, ok, type Clock, type Result } from '@kithena/domain-kit';

import { supportReason, supportSessionWindow } from '../domain/support.js';
import type { IssueHandoff } from './handoff.js';

/**
 * An operator signs in to a company as its support agent.
 *
 * Who is asking comes from the operator's own session and from nothing the
 * caller says about itself: the back office forwards the id of the session its
 * cookie names, and `supportAgentOf` turns that into an operator or refuses. An
 * `operatorId` in the request is never read.
 *
 * The result is a handoff code, the same sixty-second single-use code a
 * passkey sign-in ends with, which the new tab carries to the company's
 * `/auth/callback`. The session and its audit row already exist by then.
 */

export const OperatorRefused = failure('OPERATOR_UNAUTHENTICATED', 'Not signed in');
export const TenantUnknown = failure('TENANT_UNKNOWN', 'No such company');

export interface StartSupportDeps {
  /**
   * The support agent behind an operator session, or null.
   *
   * The one place that decides who may act as support. Today every active,
   * signed-in back-office operator is a support agent and acts as themselves;
   * a separate support roster, when there is one, is a change here and nowhere
   * else.
   */
  readonly supportAgentOf: (operatorSessionId: string) => Promise<string | null>;
  /**
   * Create the company's support account if it has none, a support session on
   * it, and the `platform.support_access` row — one transaction. False when
   * the company does not exist.
   */
  readonly begin: (input: {
    readonly tenantId: string;
    readonly operatorId: string;
    readonly reason: string;
    readonly sessionId: string;
    readonly startedAt: string;
    readonly expiresAt: string;
  }) => Promise<boolean>;
  readonly issueHandoff: IssueHandoff;
  readonly clock: Clock;
  readonly newId: () => string;
}

export type StartSupport = (input: {
  readonly operatorSessionId: string;
  readonly tenantId: string;
  readonly reason: unknown;
}) => Promise<Result<{ code: string; expiresAt: string }>>;

export function startSupport(deps: StartSupportDeps): StartSupport {
  return async ({ operatorSessionId, tenantId, reason: raw }) => {
    const operatorId = await deps.supportAgentOf(operatorSessionId);
    if (operatorId === null) return err(OperatorRefused);

    const reason = supportReason(raw);
    if (!reason.ok) return reason;

    const sessionId = deps.newId();
    const window = supportSessionWindow(deps.clock.now());
    const begun = await deps.begin({
      tenantId,
      operatorId,
      reason: reason.value,
      sessionId,
      ...window,
    });
    if (!begun) return err(TenantUnknown);

    const issued = await deps.issueHandoff({ tenantId, sessionId });
    if (!issued.ok) return issued;
    return ok({ code: issued.value.code, expiresAt: window.expiresAt });
  };
}
