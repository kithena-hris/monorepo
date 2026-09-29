import type { IncomingMessage, ServerResponse } from 'node:http';

import { presentsInternalToken, readJsonBody } from '../../shared/internal-token.js';

/**
 * A person's own preferences, for the tenant app:
 * `GET` and `PUT /api/internal/tenants/<tenant>/accounts/<account>/preferences/<name>`.
 *
 * The tenant app calls it from the server with the internal token, for the
 * account its session says is signed in; a browser never reaches it. Identity
 * keeps the value and does not interpret it — the app that owns a preference
 * validates it, on its server, before it is sent (the keyboard shortcuts'
 * clash rules are the tenant app's, not identity's). What is checked here is
 * that it is small, an object, and one of this company's accounts.
 *
 * - `GET`: 200 `{ value }`, `value` null when never set; 404 for an account
 *   this company does not have.
 * - `PUT` `{ value }`: 204, or 400 for a value that is not an object (or a
 *   body too large to read), 413 for a value past 16 KB, 404 as above.
 */
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const PATH = new RegExp(
  `^/api/internal/tenants/(${UUID})/accounts/(${UUID})/preferences/([a-z][a-z0-9-]{0,63})$`,
  'i',
);

/** As the table's check constraint has it. */
export const MAX_PREFERENCE_BYTES = 16 * 1024;

export interface PreferenceRoutesDeps {
  readonly internalToken: string;
  /** The value, `null` when never set, or `undefined` when the account is not this tenant's. */
  readonly read: (tenantId: string, accountId: string, name: string) => Promise<unknown>;
  /** False when the account is not this tenant's. */
  readonly write: (
    tenantId: string,
    accountId: string,
    name: string,
    value: Readonly<Record<string, unknown>>,
  ) => Promise<boolean>;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

export function preferenceRoutes({ internalToken, read, write }: PreferenceRoutesDeps) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<boolean> => {
    const match = PATH.exec((request.url ?? '').split('?')[0] ?? '');
    if (!match) return false;
    const [, tenantId = '', accountId = '', rawName = ''] = match;
    const name = rawName.toLowerCase();

    if (request.method !== 'GET' && request.method !== 'PUT') {
      response.writeHead(405, { allow: 'GET, PUT' }).end();
      return true;
    }
    if (!presentsInternalToken(request, internalToken)) {
      response.writeHead(401).end();
      return true;
    }

    if (request.method === 'GET') {
      const value = await read(tenantId, accountId, name);
      if (value === undefined) {
        response.writeHead(404).end();
        return true;
      }
      response
        .writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        .end(JSON.stringify({ value }));
      return true;
    }

    const body = await readJsonBody(request, MAX_PREFERENCE_BYTES * 2);
    const value: unknown = isObject(body) ? body['value'] : undefined;
    if (!isObject(value)) {
      response.writeHead(400).end();
      return true;
    }
    if (Buffer.byteLength(JSON.stringify(value)) > MAX_PREFERENCE_BYTES) {
      response.writeHead(413).end();
      return true;
    }
    const known = await write(tenantId, accountId, name, value);
    response.writeHead(known ? 204 : 404).end();
    return true;
  };
}
