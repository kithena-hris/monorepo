import type { IncomingMessage, ServerResponse } from 'node:http';

import { presentsInternalToken, readJsonBody } from '../../shared/internal-token.js';
import type { GoogleBegin, GoogleFinish } from '../application/sign-in-with-google.js';
import { deviceFrom } from './webauthn-routes.js';

/**
 * Signing in with Google, for the auth origin, which alone faces the browser.
 *
 * `POST /api/internal/google/begin` `{ tenantSlug, app? }`
 *   200 `{ url }`, Google's address to send the browser to; 404 when the
 *   company does not exist or has not switched Google on.
 *
 * `POST /api/internal/google/finish` `{ code, state, device }`
 *   200 `{ tenantSlug, code, app }`, `code` the handoff the company's
 *   `/auth/callback` redeems; or 401 `{ tenantSlug }`
 *   with the company to send a refusal back to, null when even that is unknown.
 */
const BEGIN = '/api/internal/google/begin';
const FINISH = '/api/internal/google/finish';

const json = (response: ServerResponse, status: number, body: unknown): void => {
  response
    .writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    .end(JSON.stringify(body));
};

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

export function googleRoutes({
  begin,
  finish,
  internalToken,
}: {
  readonly begin: GoogleBegin;
  readonly finish: GoogleFinish;
  readonly internalToken: string;
}) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<boolean> => {
    const path = (request.url ?? '').split('?')[0];
    if (path !== BEGIN && path !== FINISH) return false;

    if (request.method !== 'POST') {
      response.writeHead(405, { allow: 'POST' }).end();
      return true;
    }
    if (!presentsInternalToken(request, internalToken)) {
      response.writeHead(401).end();
      return true;
    }
    const body = await readJsonBody(request);
    if (body === null || typeof body !== 'object') {
      response.writeHead(400).end();
      return true;
    }
    const field = (key: string): unknown => Reflect.get(body, key);

    if (path === BEGIN) {
      const asked = field('app');
      const app =
        asked !== null && typeof asked === 'object'
          ? {
              redirect: text(Reflect.get(asked, 'redirect')),
              challenge: text(Reflect.get(asked, 'challenge')),
            }
          : null;
      const url = await begin({
        tenantSlug: text(field('tenantSlug')),
        // Kept only whole; the tenant app checks both again before using them.
        app: app !== null && app.redirect !== '' && app.challenge !== '' ? app : null,
      });
      if (url === null) json(response, 404, { message: 'Not found.' });
      else json(response, 200, { url });
      return true;
    }

    const finished = await finish({
      code: text(field('code')),
      state: text(field('state')),
      device: deviceFrom(field('device')),
    });
    if (finished.kind === 'refused') json(response, 401, { tenantSlug: finished.tenantSlug });
    else {
      const { kind: _kind, ...signedIn } = finished;
      json(response, 200, signedIn);
    }
    return true;
  };
}
