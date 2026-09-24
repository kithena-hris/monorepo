import { createServer } from 'node:http';
import { drain, logger, onShutdown, startTelemetry } from '@kithena/telemetry';
import { deploymentEntitlements } from '@kithena/contracts';

import { wirePeopleConsumer } from './account/consumers/wire.js';
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

const PORT = Number(process.env['IDENTITY_PORT'] ?? 4100);

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

/*
 * The origin every enrolment and recovery link is built on.
 *
 * Required outside development, because the fallback is a localhost address and
 * the failure it produces is silent: a deployment that never set this emails a
 * new hire a link to a machine that is not theirs, and nothing in the send path
 * can tell that apart from a correct one. Better to refuse to start and name
 * the setting.
 *
 * The same argument as `AUTH_SIGNING_KEY` above, one step further: a missing
 * key looks like random sign-outs, a missing origin looks like a link that
 * works on the developer's laptop and nowhere else.
 */
const authOrigin = process.env['AUTH_ORIGIN'];
if (authOrigin === undefined || authOrigin === '') {
  if (process.env['NODE_ENV'] === 'production') {
    throw new Error('AUTH_ORIGIN is required in production: it is what enrolment links point at');
  }
  logger.warn(
    { service: 'identity', assumed: 'http://auth.app.localhost:3100' },
    'no AUTH_ORIGIN: enrolment links will point at localhost',
  );
}

const databaseUrl = required('IDENTITY_DATABASE_URL');

const routes = await compose({
  // Deliberately not `DATABASE_URL`. That one is the owner's, used by
  // migrations, and an owner bypasses row-level security on its own tables
  // regardless of any policy. Identity connects as `svc_identity`, which cannot.
  databaseUrl,
  // Optional now: challenges live in Postgres. Passed through so a deployment
  // with a real always-on Redis can still choose the Valkey store.
  ...(process.env['VALKEY_URL'] ? { valkeyUrl: process.env['VALKEY_URL'] } : {}),
  internalToken: required('INTERNAL_API_TOKEN'),
  rpId: process.env['WEBAUTHN_RP_ID'] ?? 'app.localhost',
  /*
   * Where a company's uploaded images may be served from, comma separated. An
   * entry beginning with a dot is a suffix — `.public.blob.vercel-storage.com`
   * covers every bucket. Absent, the Blob host every deployment uses today is
   * assumed; `docs/self-hosting.md` says why this is configuration at all.
   */
  ...(process.env['IDENTITY_IMAGE_HOSTS']
    ? {
        imageHosts: process.env['IDENTITY_IMAGE_HOSTS']
          .split(',')
          .map((host) => host.trim())
          .filter((host) => host !== ''),
      }
    : {}),
  adminRpId: process.env['ADMIN_RP_ID'] ?? 'localhost',
  adminOrigin: process.env['ADMIN_ORIGIN'] ?? 'http://localhost:3001',
  authOrigin:
    authOrigin === undefined || authOrigin === '' ? 'http://auth.app.localhost:3100' : authOrigin,
  signingKey,
  allowInsecureOrigins: process.env['NODE_ENV'] !== 'production',
  // Optional. Absent, invitations are not emailed and the enrolment link comes
  // back in the response only — a supported deployment, not a broken one.
  ...(process.env['MESSAGING_URL'] ? { messagingUrl: process.env['MESSAGING_URL'] } : {}),
  // Its own secret, falling back to the shared one. See `Config.messagingToken`.
  ...(process.env['MESSAGING_API_TOKEN']
    ? { messagingToken: process.env['MESSAGING_API_TOKEN'] }
    : {}),
  // The same, for People reading a tenant's accounts. See `Config.peopleToken`.
  ...(process.env['PEOPLE_IDENTITY_TOKEN']
    ? { peopleToken: process.env['PEOPLE_IDENTITY_TOKEN'] }
    : {}),
  // What a company with no modules recorded holds (PEO-114): a default only.
  defaultEntitlements: deploymentEntitlements(process.env['KITHENA_ENTITLEMENTS']),
  // Access tokens for the router (PEO-113): rotation keys, issuer, audience.
  ...(process.env['AUTH_VERIFICATION_KEYS']
    ? {
        verificationKeys: JSON.parse(process.env['AUTH_VERIFICATION_KEYS']) as Record<
          string,
          unknown
        >[],
      }
    : {}),
  ...(process.env['AUTH_ISSUER'] ? { tokenIssuer: process.env['AUTH_ISSUER'] } : {}),
  ...(process.env['AUTH_TOKEN_AUDIENCE']
    ? { tokenAudience: process.env['AUTH_TOKEN_AUDIENCE'] }
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

// People's corrections to the cached name and start date (PRD §5).
wirePeopleConsumer(databaseUrl);

// SIGTERM drains it, then the process exits (PEO-118). The composition's
// one-connection pool is idle once the requests are done.
onShutdown('http server', () => drain(server));

server.listen(PORT, () => {
  logger.info({ service: 'identity', port: PORT }, 'identity listening');
});
