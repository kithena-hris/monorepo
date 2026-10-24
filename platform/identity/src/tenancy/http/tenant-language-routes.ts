import type { IncomingMessage, ServerResponse } from 'node:http';

import { presentsInternalToken } from '../../shared/internal-token.js';

/**
 * The company's language, by its id: `GET /api/internal/tenants/<id>/language`,
 * answering `{ "language": "de" }`.
 *
 * Messaging asks before it writes an email, so every email a company sends is
 * in the language its back office chose, whatever each reader chose for their
 * own screens. By id rather than label, because a notice arrives knowing the
 * tenant's id and nothing else about it.
 */
const PATH =
  /^\/api\/internal\/tenants\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/language$/i;

export interface TenantLanguageRoutesDeps {
  readonly token: string;
  /** Null when no such company exists. */
  readonly read: (tenantId: string) => Promise<string | null>;
}

export function tenantLanguageRoutes({ token, read }: TenantLanguageRoutesDeps) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<boolean> => {
    const match = PATH.exec((request.url ?? '').split('?')[0] ?? '');
    if (!match) return false;
    if (request.method !== 'GET') {
      response.writeHead(405, { allow: 'GET' }).end();
      return true;
    }
    if (!presentsInternalToken(request, token)) {
      response.writeHead(401).end();
      return true;
    }
    const language = await read(match[1] ?? '');
    if (language === null) {
      response.writeHead(404).end();
      return true;
    }
    response
      .writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      .end(JSON.stringify({ language }));
    return true;
  };
}
