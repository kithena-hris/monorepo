import { createServer } from 'node:http';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { logger, startTelemetry } from '@kithena/telemetry';

import { resolveTenant } from './tenancy/application/resolve-tenant.js';
import { drizzleTenantRepository } from './tenancy/infrastructure/drizzle-tenant-repository.js';
import { tenantRoutes } from './tenancy/http/tenant-routes.js';

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

const routes = tenantRoutes({
  resolve: resolveTenant({ tenants: drizzleTenantRepository(db) }),
  internalToken,
});

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
