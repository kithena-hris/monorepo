import type { IncomingMessage, ServerResponse } from 'node:http';
import { presentsInternalToken } from '@kithena/auth-kit';

import { readJsonBody } from '../../shared/internal-token.js';
import type { Authenticate } from '../application/authenticate.js';

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
}

export function sessionRoutes({ authenticate, internalToken, workEmailOf }: SessionRoutesDeps) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<boolean> => {
    const path = (request.url ?? '').split('?')[0] ?? '';
    if (path !== SESSION) return false;

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
