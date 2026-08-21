import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { Redis } from 'ioredis';
import { ok, systemClock } from '@kithena/domain-kit';
import { logger, startTelemetry } from '@kithena/telemetry';

import { resolveTenant } from './tenancy/application/resolve-tenant.js';
import { drizzleTenantRepository } from './tenancy/infrastructure/drizzle-tenant-repository.js';
import { tenantRoutes } from './tenancy/http/tenant-routes.js';
import { developmentKey, joseSigner } from './token/infrastructure/jose-signer.js';
import { jwksRoute } from './token/http/jwks-route.js';
import { startSession } from './account/application/start-session.js';
import {
  drizzleAccountRepository,
  findActiveAccountForIdentity,
} from './account/infrastructure/drizzle-account-repository.js';
import { signInWithPasskey } from './credential/application/sign-in-with-passkey.js';
import { signIn } from './credential/application/sign-in.js';
import { drizzleCredentialRepository } from './credential/infrastructure/drizzle-credential-repository.js';
import { simpleWebAuthnRelyingParty } from './credential/infrastructure/simplewebauthn-relying-party.js';
import { valkeyChallengeStore } from './credential/infrastructure/valkey-challenge-store.js';
import { webauthnRoutes } from './credential/http/webauthn-routes.js';
import { defaultCredentialPolicy } from './credential/domain/credential.js';
import { uuidv7 } from './shared/uuid.js';

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
 */

startTelemetry('kithena-identity');

const PORT = 4100;

// Deliberately not `DATABASE_URL`. That one is the owner's, used by migrations,
// and an owner bypasses row-level security on its own tables regardless of any
// policy. Identity connects as `svc_identity`, which cannot.
const connectionString = process.env['IDENTITY_DATABASE_URL'];
if (!connectionString) throw new Error('IDENTITY_DATABASE_URL is required');

const internalToken = process.env['INTERNAL_API_TOKEN'] ?? '';
if (!internalToken) throw new Error('INTERNAL_API_TOKEN is required');

const db = drizzle(postgres(connectionString));

/**
 * The signing key.
 *
 * Read from the environment as a JWK, or generated on the spot outside
 * production. The generated one is not a quiet fallback: it says so, loudly,
 * because a deployment signing with a key that changes on every restart does
 * not look like a missing configuration — it looks like users being logged out
 * at random, which is a much longer afternoon.
 */
const signingKey = process.env['AUTH_SIGNING_KEY'];
if (!signingKey && process.env['NODE_ENV'] === 'production') {
  throw new Error('AUTH_SIGNING_KEY is required in production');
}
if (!signingKey) {
  logger.warn(
    { service: 'identity' },
    'no AUTH_SIGNING_KEY: generating a throwaway key. Every restart invalidates every token.',
  );
}

const signer = await joseSigner(
  signingKey === undefined ? await developmentKey() : (JSON.parse(signingKey) as never),
);

/**
 * The sign-in path, composed.
 *
 * `main.ts` is the only place allowed to know about more than one slice, which
 * is why the wiring is here and not in a use case. `no-cross-slice-imports`
 * refuses the alternative, and correctly: the credential slice declares the two
 * account operations it needs and this supplies them.
 */
const valkey = new Redis(process.env['VALKEY_URL'] ?? 'redis://localhost:6379');

const accounts = drizzleAccountRepository();
const inTenantTransaction = <T>(
  tenantId: string,
  fn: (tx: PostgresJsDatabase) => Promise<T>,
): Promise<T> =>
  db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx);
  });

const begin = startSession({ accounts, inTenantTransaction });

/**
 * The relying party and the challenge store are built once and shared.
 *
 * Both happen to be stateless — the store's state is in Valkey — so two
 * instances would have worked. Sharing them anyway, because "it works because
 * this adapter holds nothing" is a property somebody has to keep true, and a
 * single instance does not ask them to.
 */
const RP_ID = process.env['WEBAUTHN_RP_ID'] ?? 'app.localhost';
const relyingParty = simpleWebAuthnRelyingParty({ rpId: RP_ID, rpName: 'Kithena' });
const challenges = valkeyChallengeStore(valkey);

const webauthn = webauthnRoutes({
  rp: relyingParty,
  challenges,
  internalToken,
  onRefusal: (reason, detail) => {
    logger.info({ reason, ...detail }, 'sign-in refused');
  },
  signIn: signIn({
    verify: signInWithPasskey({
      rp: relyingParty,
      challenges,
      credentials: drizzleCredentialRepository(db),
      origins: {
        rpId: RP_ID,
        authOrigin: process.env['AUTH_ORIGIN'] ?? 'http://auth.app.localhost:3000',
        allowInsecure: process.env['NODE_ENV'] !== 'production',
      },
      // Per-tenant authenticator policy lands with the auth settings screen.
      // Until then every tenant gets the floor, which requires user
      // verification and accepts synced passkeys.
      policyFor: () => Promise.resolve(defaultCredentialPolicy),
      onRefusal: (reason) => {
        logger.info({ reason }, 'passkey refused');
      },
    }),
    activeAccountFor: (tenantId, identityId) =>
      inTenantTransaction(tenantId, (tx) => findActiveAccountForIdentity(tx, identityId)),
    beginSession: async (tenantId, accountId, device, amr) => {
      const sessionId = uuidv7();
      const result = await begin(
        tenantId,
        accountId,
        { id: sessionId, device, amr },
        {
          clock: systemClock,
          newEventId: () => uuidv7(),
          actor: { kind: 'user', userId: accountId },
          correlationId: randomUUID(),
          causationId: null,
        },
      );
      if (!result.ok) return result;

      return ok({
        sessionId,
        accountId,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      });
    },
    onRefusal: (reason) => {
      logger.info({ reason }, 'sign-in refused');
    },
  }),
});

const tenants = tenantRoutes({
  resolve: resolveTenant({ tenants: drizzleTenantRepository(db) }),
  internalToken,
});
const jwks = jwksRoute(signer);

/**
 * Routes, tried in order.
 *
 * A list rather than a framework. There are two of them, they are matched by
 * prefix, and a router would be a dependency earning its place by saving four
 * lines. It stops being the right answer the moment there are parameters worth
 * parsing; it is not that moment yet.
 */
const routes = async (
  request: Parameters<typeof jwks>[0],
  response: Parameters<typeof jwks>[1],
): Promise<boolean> =>
  jwks(request, response) ||
  (await webauthn(request, response)) ||
  (await tenants(request, response));

const server = createServer((request, response) => {
  void routes(request, response)
    .then((handled) => {
      if (!handled) response.writeHead(404).end();
    })
    .catch((error: unknown) => {
      // The message never reaches the caller. A database error rendered into a
      // response is a schema disclosure on the one endpoint reachable before
      // anybody has authenticated.
      logger.error({ error, url: request.url }, 'unhandled request failure');
      if (!response.headersSent) response.writeHead(500).end();
    });
});

server.listen(PORT, () => {
  logger.info({ service: 'identity', port: PORT }, 'identity listening');
});
