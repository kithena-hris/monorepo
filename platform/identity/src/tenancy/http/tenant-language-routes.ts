import type { IncomingMessage, ServerResponse } from 'node:http';

import { presentsInternalToken } from '../../shared/internal-token.js';

/**
 * The company's language, by its id: `GET /api/internal/tenants/<id>/language`,
 * answering `{ "language": "de" }`, with the company's name, its mark (as
 * `brandingFor` lets it be shown) and its colour, so every email any module
 * sends is in the company's language and in its colours.
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
  /** The company's name, mark and colour; null for none known. */
  readonly brand?: (tenantId: string) => Promise<{
    readonly companyName: string;
    readonly logoUrl: string | null;
    readonly themeId: string | null;
  } | null>;
}

export function tenantLanguageRoutes({ token, read, brand }: TenantLanguageRoutesDeps) {
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
    const held = (await brand?.(match[1] ?? '')) ?? null;
    response
      .writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      .end(JSON.stringify({ language, ...(held === null ? {} : held) }));
    return true;
  };
}
