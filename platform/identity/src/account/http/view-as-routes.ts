import type { IncomingMessage, ServerResponse } from 'node:http';
import { presentsInternalToken } from '@kithena/auth-kit';

import { readJsonBody } from '../../shared/internal-token.js';
import type { StartViewAs } from '../application/start-view-as.js';

/**
 * `POST /api/internal/view-as/start`: People starts a view-as session for one
 * of its administrators (`start-view-as.ts`).
 *
 * People's own token, not the tenant app's: People is the one that decided
 * the asker may. Body `{ tenantId, adminAccountId, subjectAccountId, reason,
 * specialCategory }`.
 *
 * - 201 `{ code, expiresAt }`: the handoff code the tenant app redeems.
 * - 400 `{ code, message, path }` for a reason that is missing or too long.
 * - 403 `{ code, message }` for a refusal: an unknown or inactive account,
 *   oneself, Kithena support, or from inside another view.
 *
 * Ending one is signing it out (`/api/internal/session/revoke`), which records
 * the end; so is finding its thirty minutes over.
 */
const START = '/api/internal/view-as/start';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);

export function viewAsRoutes({
  token,
  start,
}: {
  /** People's token to identity (`PEOPLE_IDENTITY_TOKEN`), else the shared one. */
  readonly token: string;
  readonly start: StartViewAs;
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
    if (!presentsInternalToken(request, token)) return json(401, {});

    const body = ((await readJsonBody(request)) ?? {}) as Record<string, unknown>;
    const { tenantId, adminAccountId, subjectAccountId, specialCategory } = body;
    if (
      !isUuid(tenantId) ||
      !isUuid(adminAccountId) ||
      !isUuid(subjectAccountId) ||
      typeof specialCategory !== 'boolean'
    ) {
      return json(400, { code: 'INVALID_INPUT', message: 'Not a view-as request' });
    }

    const started = await start({
      tenantId,
      adminAccountId,
      subjectAccountId,
      specialCategory,
      reason: body['reason'],
    });
    if (started.ok) return json(201, started.value);

    const { code, message, path } = started.error;
    if (code === 'VIEW_AS_REASON_REQUIRED' || code === 'VIEW_AS_REASON_TOO_LONG') {
      return json(400, { code, message, path });
    }
    if (code.startsWith('VIEW_AS_')) return json(403, { code, message });
    // The handoff could not be issued: the session was removed in between.
    return json(409, {});
  };
}
