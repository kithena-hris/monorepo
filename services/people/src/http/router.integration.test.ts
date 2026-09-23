import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { AddressInfo } from 'node:net';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { createYoga } from 'graphql-yoga';
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey } from 'jose';
import { startCosmoRouter, startPostgres } from '@kithena/testing';

import { define, versionOf } from '../application/person/in-memory.js';
import { Person } from '../domain/person/person.js';
import { schema } from '../graphql/schema.js';
import { drizzlePersonRepository } from '../infrastructure/drizzle-person-repository.js';
import { drizzleSchemaRepository } from '../infrastructure/drizzle-schema-repository.js';
import { tenantTransaction } from '../infrastructure/unit-of-work.js';
import { wirePeople } from './server.js';

/**
 * PEO-092: the Cosmo Router, configured by `apps/gateway/config.yaml`, in
 * front of the real People subgraph.
 *
 * The router verifies the token against a JWKS and forwards the principal
 * with the internal token, which is what `caller.ts` requires. Composition is
 * `wgc router compose`, as `just supergraph` runs it. The production-only
 * parts of the config — the persisted-operation safelist, tracing, the event
 * broker — are turned off by an override merged over it (the router merges a
 * comma-separated list of config files), so what is tested is the file that
 * ships, not a copy of its header rules.
 */

const run = promisify(execFile);
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const ACME = '00000000-0000-4000-8000-00000000000a';
const ADA = '00000000-0000-4000-8000-0000000000a1';
const ADA_ACCOUNT = '00000000-0000-4000-8000-0000000000b1';
const TOKEN = 'router-secret';

let stopPg: (() => Promise<void>) | undefined;
const clients: ReturnType<typeof postgres>[] = [];
const servers: Server[] = [];
let router: Awaited<ReturnType<typeof startCosmoRouter>> | undefined;
let dir = '';
let url = '';
let privateKey: CryptoKey;

const listen = (server: Server): Promise<number> =>
  new Promise((resolve) => {
    server.listen(0, '0.0.0.0', () => {
      resolve((server.address() as AddressInfo).port);
    });
  });

async function token(claims: Record<string, unknown> = {}): Promise<string> {
  return new SignJWT({ sub: ADA_ACCOUNT, tid: ACME, ...claims })
    .setProtectedHeader({ alg: 'ES256', kid: 'test', typ: 'at+jwt' })
    .setExpirationTime('2m')
    .sign(privateKey);
}

const ask = (headers: Record<string, string>) =>
  fetch(`${url}/graphql`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({
      query: `{ person(id: "${ADA}") { attributes { ... on TextAttribute { key value } } } }`,
    }),
  });

beforeAll(async () => {
  const pg = await startPostgres();
  stopPg = pg.stop;
  const admin = postgres(pg.url, { max: 1, onnotice: () => {} });
  clients.push(admin);
  const migrations = join(ROOT, 'migrations');
  for (const file of (await readdir(migrations))
    .filter(
      (f) =>
        f.endsWith('.sql') &&
        ((f.includes('_people_') && !f.includes('identity')) || f.includes('tenant_registry')),
    )
    .sort()) {
    await drizzle(admin).execute(sql.raw(await readFile(join(migrations, file), 'utf8')));
  }
  await admin`ALTER ROLE svc_people LOGIN PASSWORD 'svc_people'`;
  const asService = new URL(pg.url);
  asService.username = 'svc_people';
  asService.password = 'svc_people';
  const service = postgres(asService.toString(), { max: 2 });
  clients.push(service);
  const inTenant = tenantTransaction(drizzle(service));
  await inTenant(ACME, ({ tx }) =>
    drizzlePersonRepository().create(
      tx,
      Person.rehydrate({
        id: ADA,
        tenantId: ACME,
        status: 'active',
        identityAccountId: ADA_ACCOUNT,
        hireDate: '2026-01-01',
        lastWorkingDay: null,
      }),
      { custom: { job_title: 'Engineer' } },
    ),
  );
  await inTenant(ACME, ({ tx }) =>
    drizzleSchemaRepository().appendVersion(
      tx,
      ACME,
      versionOf(1, [define({ key: 'job_title', visibility: ['self', 'hr'] })]),
      [],
      '2026-09-01',
    ),
  );

  // People, as `main.ts` boots it, without OpenFGA: the standalone relations.
  delete process.env['OPENFGA_API_URL'];
  process.env['PEOPLE_DATABASE_URL'] = asService.toString();
  process.env['PEOPLE_API_TOKEN'] = TOKEN;
  process.env['PEOPLE_SECRET_KEYS'] = `k1:${randomBytes(32).toString('base64')}`;
  const yoga = createYoga({ schema, graphqlEndpoint: '/graphql' });
  const people = createServer((request, response) => {
    void yoga(request, response);
  });
  wirePeople(people);
  servers.push(people);
  const peoplePort = await listen(people);

  // Identity's part: a key pair and its public half at a JWKS URL.
  const pair = await generateKeyPair('ES256');
  privateKey = pair.privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test', alg: 'ES256', use: 'sig' };
  const jwks = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ keys: [jwk] }));
  });
  servers.push(jwks);
  const jwksPort = await listen(jwks);

  dir = await mkdtemp(join(tmpdir(), 'kithena-router-'));
  await writeFile(
    join(dir, 'graph.yaml'),
    [
      'version: 1',
      'subgraphs:',
      '  - name: people',
      `    routing_url: http://host.docker.internal:${String(peoplePort)}/graphql`,
      '    schema:',
      `      file: ${join(ROOT, 'services/people/schemas/people.graphql')}`,
    ].join('\n'),
  );
  await run(
    join(ROOT, 'apps/gateway/node_modules/.bin/wgc'),
    ['router', 'compose', '-i', join(dir, 'graph.yaml'), '-o', join(dir, 'supergraph.json')],
    { timeout: 120_000 },
  );
  await writeFile(
    join(dir, 'override.yaml'),
    [
      'execution_config:',
      '  file:',
      '    path: /etc/router/supergraph.json',
      // What People said, passed through, so a failure names its cause.
      'subgraph_error_propagation:',
      '  enabled: true',
      '  mode: pass-through',
      '  propagate_status_codes: true',
      'persisted_operations:',
      '  safelist:',
      '    enabled: false',
      'telemetry:',
      '  tracing:',
      '    enabled: false',
      '  metrics:',
      '    otlp:',
      '      enabled: false',
      '    prometheus:',
      '      enabled: false',
    ].join('\n'),
  );

  router = await startCosmoRouter({
    files: [
      { source: join(ROOT, 'apps/gateway/config.yaml'), target: '/etc/router/config.yaml' },
      { source: join(dir, 'override.yaml'), target: '/etc/router/override.yaml' },
      { source: join(dir, 'supergraph.json'), target: '/etc/router/supergraph.json' },
    ],
    env: {
      CONFIG_PATH: '/etc/router/config.yaml,/etc/router/override.yaml',
      AUTH_JWKS_URL: `http://host.docker.internal:${String(jwksPort)}/jwks`,
      PEOPLE_API_TOKEN: TOKEN,
      KITHENA_ENTITLEMENTS: '["module.people"]',
      // Verifies a config downloaded from the CDN; this one is a file.
      GRAPH_SIGN_KEY: 'x'.repeat(32),
    },
  });
  url = router.url;
}, 240_000);

afterAll(async () => {
  await router?.stop();
  for (const server of servers) await new Promise((resolve) => server.close(resolve));
  for (const client of clients) await client.end();
  await stopPg?.();
  if (dir !== '') await rm(dir, { recursive: true, force: true });
});

describe('the router in front of People', () => {
  it('forwards the verified principal with the internal token', async () => {
    const response = await ask({ authorization: `Bearer ${await token()}` });
    const body = (await response.json()) as {
      data?: { person: { attributes: unknown[] } };
      errors?: unknown;
    };
    // The errors as text, so a failure says what People or the router said.
    expect(JSON.stringify(body.errors ?? null)).toBe('null');
    expect(body.data?.person.attributes).toEqual([{ key: 'job_title', value: 'Engineer' }]);
  });

  it('refuses a request with no token before People sees it', async () => {
    const response = await ask({});
    expect(response.status).toBe(401);
  });

  it('refuses a token it did not issue', async () => {
    const stranger = await generateKeyPair('ES256');
    const forged = await new SignJWT({ sub: ADA_ACCOUNT, tid: ACME })
      .setProtectedHeader({ alg: 'ES256', kid: 'test' })
      .setExpirationTime('2m')
      .sign(stranger.privateKey);
    expect((await ask({ authorization: `Bearer ${forged}` })).status).toBe(401);
  });

  it('overwrites a principal the client sent, rather than forwarding it', async () => {
    // A valid token for somebody else, with a principal header naming Ada:
    // the router must answer as the token's subject, who is not Ada.
    const response = await ask({
      authorization: `Bearer ${await token({ sub: '00000000-0000-4000-8000-0000000000b9' })}`,
      'x-kithena-principal': JSON.stringify({
        userId: ADA_ACCOUNT,
        tenantId: ACME,
        roles: ['hr'],
        entitlements: ['module.people'],
      }),
      'x-internal-token': TOKEN,
    });
    const body = (await response.json()) as { data?: { person: { attributes: unknown[] } } };
    expect(body.data?.person.attributes ?? []).toEqual([]);
  });
});
