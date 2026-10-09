import type { IncomingMessage, ServerResponse } from 'node:http';
import { presentsInternalToken } from '@kithena/auth-kit';

/**
 * `POST /api/internal/messaging/inbox-digest` — send every company's held
 * updates, one digest a person (INB-050). Asked once a day: by Vercel's cron
 * with its secret (`CRON_SECRET`, `GET` as cron sends it), or by a module or
 * an operator with the internal token. Nothing else may start it.
 */
const DIGEST = '/api/internal/messaging/inbox-digest';

export function digestRoutes(deps: {
  readonly flush: (() => Promise<{ readonly sent: number; readonly failed: number }>) | undefined;
  readonly internalToken: string;
  readonly cronSecret: string | undefined;
}) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<boolean> => {
    if ((request.url ?? '').split('?')[0] !== DIGEST) return false;
    if (request.method !== 'POST' && request.method !== 'GET') {
      response.writeHead(405, { allow: 'GET, POST' }).end();
      return true;
    }
    const cron =
      deps.cronSecret !== undefined &&
      deps.cronSecret !== '' &&
      request.headers.authorization === `Bearer ${deps.cronSecret}`;
    if (!cron && !presentsInternalToken(request, deps.internalToken)) {
      response.writeHead(401).end();
      return true;
    }
    if (deps.flush === undefined) {
      response
        .writeHead(503, { 'content-type': 'application/json' })
        .end(JSON.stringify({ code: 'NO_DIGESTS', reason: 'no MESSAGING_DATABASE_URL' }));
      return true;
    }
    const done = await deps.flush();
    response
      .writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      .end(JSON.stringify(done));
    return true;
  };
}
