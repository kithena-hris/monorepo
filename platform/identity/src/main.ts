import { createServer } from 'node:http';
import { logger, startTelemetry } from '@kithena/telemetry';

import { compose } from './composition.js';

/**
 * The identity service.
 *
 * Port 4100 rather than 4000: the Cosmo Router listens on 4000 and
 * `.env.example` pointed `AUTH_ISSUER` at the same number. Modules take 40xx,
 * platform services take 41xx.
 *
 * This is not a subgraph and does not speak GraphQL. Authentication happens
 * before there is a principal, sets cookies, follows redirects and speaks fixed
 * wire formats; none of that is GraphQL-shaped. It also means a customer can
 * put their own login UI in front of the same API, which is what makes the
 * headless mode in docs/authentication.md possible rather than aspirational.
 *
 * Everything this file used to do beyond starting a server now lives in
 * `composition.ts`. What is left is configuration, a listener, and the two
 * failure modes worth being loud about.
 */
startTelemetry('kithena-identity');

const PORT = 4100;

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`${name} is required`);
  return value;
}

const signingKey = process.env['AUTH_SIGNING_KEY'];
if (signingKey === undefined && process.env['NODE_ENV'] === 'production') {
  throw new Error('AUTH_SIGNING_KEY is required in production');
}
if (signingKey === undefined) {
  // Not a quiet default. A deployment signing with a key that changes on every
  // restart does not look like a missing setting — it looks like users being
  // logged out at random, which is a much longer afternoon.
  logger.warn(
    { service: 'identity' },
    'no AUTH_SIGNING_KEY: generating a throwaway key. Every restart invalidates every token.',
  );
}

const routes = await compose({
  // Deliberately not `DATABASE_URL`. That one is the owner's, used by
  // migrations, and an owner bypasses row-level security on its own tables
  // regardless of any policy. Identity connects as `svc_identity`, which cannot.
  databaseUrl: required('IDENTITY_DATABASE_URL'),
  // Optional now: challenges live in Postgres. Passed through so a deployment
  // with a real always-on Redis can still choose the Valkey store.
  ...(process.env['VALKEY_URL'] ? { valkeyUrl: process.env['VALKEY_URL'] } : {}),
  internalToken: required('INTERNAL_API_TOKEN'),
  rpId: process.env['WEBAUTHN_RP_ID'] ?? 'app.localhost',
  adminRpId: process.env['ADMIN_RP_ID'] ?? 'localhost',
  adminOrigin: process.env['ADMIN_ORIGIN'] ?? 'http://localhost:3001',
  authOrigin: process.env['AUTH_ORIGIN'] ?? 'http://auth.app.localhost:3100',
  signingKey,
  allowInsecureOrigins: process.env['NODE_ENV'] !== 'production',
  // Optional. Absent, invitations are not emailed and the enrolment link comes
  // back in the response only — a supported deployment, not a broken one.
  ...(process.env['MESSAGING_URL'] ? { messagingUrl: process.env['MESSAGING_URL'] } : {}),
  // Its own secret, falling back to the shared one. See `Config.messagingToken`.
  ...(process.env['MESSAGING_API_TOKEN']
    ? { messagingToken: process.env['MESSAGING_API_TOKEN'] }
    : {}),
});

const server = createServer((request, response) => {
  void routes(request, response)
    .then((handled) => {
      if (!handled) response.writeHead(404).end();
    })
    .catch((error: unknown) => {
      // The message never reaches the caller. A database error rendered into a
      // response is a schema disclosure on endpoints reachable before anybody
      // has authenticated.
      logger.error({ error, url: request.url }, 'unhandled request failure');
      if (!response.headersSent) response.writeHead(500).end();
    });
});

server.listen(PORT, () => {
  logger.info({ service: 'identity', port: PORT }, 'identity listening');
});
