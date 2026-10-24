import type { IncomingMessage, ServerResponse } from 'node:http';
import { presentsInternalToken } from '@kithena/auth-kit';

import type { CompanyLanguage } from '../application/company-language.js';

/**
 * `GET /api/internal/messaging/language?tenantId=<id>` — the language a
 * company's emails are written in, `{ "language": "de" }`.
 *
 * For a module about to write an email in its own words (Recruiting's,
 * Onboarding's, Performance's, Time Off's nudge): it asks here, with the token
 * it already sends email with, and writes in that language. One place decides
 * the language, so the frame messaging draws and the words inside it agree.
 */
const PATH = '/api/internal/messaging/language';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function languageRoutes(deps: {
  readonly language: CompanyLanguage;
  /** Every module's token; an empty one never matches. */
  readonly internalTokens: readonly string[];
}) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<boolean> => {
    const url = new URL(request.url ?? '/', 'http://messaging');
    if (url.pathname !== PATH) return false;
    if (request.method !== 'GET') {
      response.writeHead(405, { allow: 'GET' }).end();
      return true;
    }
    if (
      !deps.internalTokens.some((token) => token !== '' && presentsInternalToken(request, token))
    ) {
      response.writeHead(401).end();
      return true;
    }
    const tenantId = url.searchParams.get('tenantId') ?? '';
    if (!UUID.test(tenantId)) {
      response.writeHead(400).end();
      return true;
    }
    const { language } = await deps.language(tenantId);
    response
      .writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      .end(JSON.stringify({ language }));
    return true;
  };
}
