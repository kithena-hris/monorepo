import type { IncomingMessage, ServerResponse } from 'node:http';
import { presentsInternalToken } from '@kithena/auth-kit';

import { readJsonBody } from '../../shared/internal-token.js';
import type { StartSupport } from '../application/start-support.js';

/**
 * `POST /api/internal/support/start`: the back office signs an operator in to a
 * company as its support agent.
 *
 * Body `{ operatorSessionId, tenantId, reason }`. The internal token says the
 * back office sent it; the operator session says which operator, and is
 * checked here like any other operator request. Nothing else in the body is
 * read — an `operatorId` sent alongside is ignored, not trusted.
 *
 * 201 `{ code, expiresAt }`: the handoff code for the company's
 * `/auth/callback`, and when the support session ends.
 */
const START = '/api/internal/support/start';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function supportRoutes({
  internalToken,
  start,
}: {
  readonly internalToken: string;
  readonly start: StartSupport;
}) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<boolean> => {
    if ((request.url ?? '').split('?')[0] !== START) return false;

    const json = (status: number, body: unknown): true => {
      response
        .writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        .end(JSON.stringify(body));
      return true;
    };

    if (request.method !== 'POST') {
      response.writeHead(405, { allow: 'POST' }).end();
      return true;
    }
    if (!presentsInternalToken(request, internalToken)) return json(401, {});

    const body = ((await readJsonBody(request)) ?? {}) as Record<string, unknown>;
    const operatorSessionId = body['operatorSessionId'];
    const tenantId = body['tenantId'];
    // Shapes first, because `::uuid` on anything else is a 500 rather than a refusal.
    if (typeof operatorSessionId !== 'string' || !UUID.test(operatorSessionId)) {
      return json(401, {});
    }
    if (typeof tenantId !== 'string' || !UUID.test(tenantId)) return json(404, {});

    const started = await start({ operatorSessionId, tenantId, reason: body['reason'] });
    if (started.ok) return json(201, started.value);

    switch (started.error.code) {
      case 'OPERATOR_UNAUTHENTICATED':
        return json(401, {});
      case 'TENANT_UNKNOWN':
        return json(404, {});
      case 'SUPPORT_REASON_REQUIRED':
      case 'SUPPORT_REASON_TOO_LONG':
        return json(400, {
          code: started.error.code,
          message: started.error.message,
          path: started.error.path,
        });
      default:
        // The handoff could not be issued: the session was removed in between.
        return json(409, {});
    }
  };
}
