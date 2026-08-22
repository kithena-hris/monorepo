import type { VercelRequest, VercelResponse } from '@vercel/node';

import { compose, type RequestHandler } from '../src/composition.js';

/**
 * The identity service, as a Vercel function.
 *
 * The same composed router that `src/main.ts` puts behind `node:http`. Nothing
 * under `src/` knows this file exists, and that is the point: a Vercel Node
 * function receives `VercelRequest` and `VercelResponse`, which extend
 * `IncomingMessage` and `ServerResponse`, so every route moved here unchanged
 * and so did its tests.
 *
 * `src/main.ts` stays. It is what `just dev` runs and what a container would
 * run, and keeping it means this service is still a plain HTTP server that
 * happens to be deployed as a function rather than one that can only be a
 * function.
 */

/*
 * Composed once per instance, not once per request.
 *
 * Module scope runs when the instance boots and is reused for every request it
 * serves afterwards, so the Postgres pool and the signing key are built once.
 * Doing this inside the handler would open a connection per request, which is
 * the objection that sent this service to a container in the first place.
 *
 * The promise rather than the value: top-level await would block the module,
 * and awaiting the same promise in each request gives the identical result
 * without serialising the boot.
 */
let routesPromise: Promise<RequestHandler> | undefined;

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`${name} is required`);
  return value;
}

function routes(): Promise<RequestHandler> {
  routesPromise ??= compose({
    // Deliberately not `DATABASE_URL`. That one is the owner's, used by
    // migrations, and an owner bypasses row-level security on its own tables
    // regardless of any policy. Identity connects as `svc_identity`, which
    // cannot — and on Vercel this must be Neon's *pooled* host.
    databaseUrl: required('IDENTITY_DATABASE_URL'),
    internalToken: required('INTERNAL_API_TOKEN'),
    rpId: process.env['WEBAUTHN_RP_ID'] ?? 'app.localhost',
    adminRpId: process.env['ADMIN_RP_ID'] ?? 'localhost',
    adminOrigin: process.env['ADMIN_ORIGIN'] ?? 'http://localhost:3001',
    authOrigin: process.env['AUTH_ORIGIN'] ?? 'http://auth.app.localhost:3100',
    signingKey: process.env['AUTH_SIGNING_KEY'],
    allowInsecureOrigins: process.env['VERCEL_ENV'] !== 'production',
  });
  return routesPromise;
}

/**
 * Puts the original path back before the router sees it.
 *
 * `vercel.json` rewrites every request here and passes the path it came in on
 * as `__path`, because by the time the function runs `req.url` names the
 * function rather than what the caller asked for.
 *
 * A query parameter set by the rewrite rather than a catch-all segment. The
 * obvious `[...path].ts` with `"/(.*)" -> "/api/$1"` cannot work: the rewrite
 * matches paths that already begin `/api`, so `/api/internal/tenant/acme`
 * becomes `/api/api/internal/tenant/acme` and matches nothing. Everything
 * 404s, including the routes that would have worked without any rewrite at
 * all.
 *
 * It is also not a header. `__path` arrives in the URL the platform rewrote,
 * not from the caller — a router that trusts a caller-supplied header is a
 * router an attacker chooses their way through.
 */
const INTERNAL = '__path';

function originalUrl(request: VercelRequest): string {
  const raw = request.query[INTERNAL];
  const first = Array.isArray(raw) ? raw[0] : raw;
  // Leading slash enforced rather than assumed: `req.url` without one is not a
  // path any of the route tables will match.
  const path = typeof first === 'string' && first.startsWith('/') ? first : '/';

  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(request.query)) {
    if (key === INTERNAL) continue;
    for (const item of Array.isArray(value) ? value : [value]) {
      if (typeof item === 'string') query.append(key, item);
    }
  }

  const search = query.toString();
  return search === '' ? path : `${path}?${search}`;
}

export default async function handler(
  request: VercelRequest,
  response: VercelResponse,
): Promise<void> {
  request.url = originalUrl(request);

  try {
    const handled = await (await routes())(request, response);
    if (!handled) response.writeHead(404).end();
  } catch (error) {
    // The message never reaches the caller. A database error rendered into a
    // response is a schema disclosure on endpoints reachable before anybody has
    // authenticated. It does reach the log, which is where it is useful.
    console.error('unhandled request failure', { url: request.url, error });
    if (!response.headersSent) response.writeHead(500).end();
  }
}
