import type { IncomingMessage, ServerResponse } from 'node:http';
import { presentsInternalToken } from '@kithena/auth-kit';

import { readJsonBody } from '../../shared/internal-token.js';
import type { Authenticate } from '../application/authenticate.js';
import type { IssueHandoff, RedeemHandoff } from '../application/handoff.js';
import type { RevokeSession } from '../application/revoke-session.js';

/**
 * "Is this cookie still a session, and whose?"
 *
 * The tenant app asks this on every request that renders anything belonging to
 * a person. It is the employee counterpart of `/api/internal/operator/session`,
 * and it exists because `authenticate` was written, tested, and then reachable
 * from nothing.
 *
 * **The tenant comes from the caller, never from the session.** The app knows
 * which company it is serving from its own hostname, and passing it in is what
 * lets `authenticate` refuse a cookie lifted from one tenant's browser and
 * replayed against another's — rather than hoping row-level security notices
 * later.
 */
const SESSION = '/api/internal/session';

/**
 * The two halves of the auth-origin-to-tenant-origin handoff.
 *
 * `ISSUE` is called by the origin that just verified a passkey; `REDEEM` by the
 * origin that will hold the cookie. Both require the internal token, so the
 * exchange happens on a back channel the browser is not part of — the browser
 * only ever carries the code, in a redirect, for as long as one navigation
 * takes.
 */
/** Ending a session on purpose, rather than waiting for it to lapse. */
const REVOKE = '/api/internal/session/revoke';

const HANDOFF_ISSUE = '/api/internal/handoff/issue';
const HANDOFF_REDEEM = '/api/internal/handoff/redeem';

export interface SessionRoutesDeps {
  readonly authenticate: Authenticate;
  readonly internalToken: string;
  /**
   * The work email for an account. Used once, to greet somebody by name.
   *
   * A separate lookup rather than a field on the session: the cached session is
   * read on every request and carries only what an authorisation decision
   * needs. An address is not that.
   */
  readonly workEmailOf: (tenantId: string, accountId: string) => Promise<string | null>;
  readonly issueHandoff: IssueHandoff;
  readonly redeemHandoff: RedeemHandoff;
  readonly revoke: RevokeSession;
}

export function sessionRoutes({
  authenticate,
  internalToken,
  workEmailOf,
  issueHandoff,
  redeemHandoff,
  revoke,
}: SessionRoutesDeps) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<boolean> => {
    const path = (request.url ?? '').split('?')[0] ?? '';
    const handoff = path === HANDOFF_ISSUE || path === HANDOFF_REDEEM;
    if (path !== SESSION && path !== REVOKE && !handoff) return false;

    if (request.method !== 'POST') {
      response.writeHead(405, { allow: 'POST' }).end();
      return true;
    }
    if (!presentsInternalToken(request, internalToken)) {
      response.writeHead(401).end();
      return true;
    }

    const json = (status: number, body: unknown): true => {
      response
        .writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        .end(JSON.stringify(body));
      return true;
    };

    const body = (await readJsonBody(request)) as Record<string, unknown> | null;
    const sessionId = typeof body?.['sessionId'] === 'string' ? body['sessionId'] : '';
    const tenantId = typeof body?.['tenantId'] === 'string' ? body['tenantId'] : '';

    if (path === REVOKE) {
      if (sessionId === '' || tenantId === '') return json(400, {});

      /*
       * 204 whatever was there, and deliberately not 404 for a session that had
       * already gone. Signing out is idempotent — a second click, a retried
       * request, or a cookie whose row expired an hour ago all mean the same
       * thing to the person doing it, and reporting "no such session" invites a
       * caller to treat a successful logout as a failure and leave the cookie
       * in place.
       */
      await revoke(tenantId, sessionId);
      response.writeHead(204, { 'cache-control': 'no-store' }).end();
      return true;
    }

    if (path === HANDOFF_ISSUE) {
      if (sessionId === '' || tenantId === '') return json(400, {});
      // No check that the session is live. It was created moments ago by the
      // caller that is asking, and a code is worth nothing without one — the
      // session is what `authenticate` will judge, on every request after this.
      // A session that no longer exists is refused by the foreign key and comes
      // back as a refusal rather than a 500.
      const issued = await issueHandoff({ tenantId, sessionId });
      if (!issued.ok) return json(401, {});
      return json(201, issued.value);
    }

    if (path === HANDOFF_REDEEM) {
      const code = typeof body?.['code'] === 'string' ? body['code'] : '';
      if (code === '' || tenantId === '') return json(400, {});

      const redeemed = await redeemHandoff({ code, tenantId });
      // 401 for every refusal, with nothing to tell them apart — see
      // `HandoffRefused`. The distinguishing detail is in the log.
      if (!redeemed.ok) return json(401, {});
      return json(200, { sessionId: redeemed.value.sessionId });
    }

    if (sessionId === '' || tenantId === '') return json(400, {});

    const session = await authenticate(tenantId, sessionId);
    // 401 and nothing else. Expired, revoked, never existed, and belonging to
    // another company are one answer here: the caller renders a sign-in page
    // for all four, and the differences are only useful to somebody probing.
    if (!session.ok) return json(401, {});

    return json(200, {
      accountId: session.value.accountId,
      identityId: session.value.identityId,
      workEmail: await workEmailOf(tenantId, session.value.accountId),
      amr: session.value.amr,
      authenticatedAt: session.value.authenticatedAt,
      expiresAt: session.value.expiresAt,
    });
  };
}
