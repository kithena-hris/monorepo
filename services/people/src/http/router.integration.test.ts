import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
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
import {
  calculateJwkThumbprint,
  exportJWK,
  generateKeyPair,
  importJWK,
  SignJWT,
  type CryptoKey,
  type JWK,
} from 'jose';
import { startCosmoRouter, startPostgres } from '@kithena/testing';

import { define, versionOf } from '../application/person/in-memory.js';
import { Person } from '../domain/person/person.js';
import { yogaOptions } from '../graphql/schema.js';
import { drizzlePersonRepository } from '../infrastructure/drizzle-person-repository.js';
import { drizzleSchemaRepository } from '../infrastructure/drizzle-schema-repository.js';
import { tenantTransaction } from '../infrastructure/unit-of-work.js';
import { wirePeople } from './server.js';

/**
 * PEO-092: the Cosmo Router, configured by `apps/gateway/config.yaml`, in
 * front of the real People subgraph.
 *
 * The router verifies the token against a JWKS and forwards the principal
 * with the internal token, which is what `caller.ts` requires.
 *
 * PEO-113: the JWKS and the token are identity's, from identity itself —
 * `platform/identity/src/main.ts` run as a process beside the router (a
 * process, not an import: People may not import the platform). The token is
 * the one identity issues the tenant app's server for a session; the router
 * refuses one that has expired, one for another audience, one signed by a key
 * identity never published, and accepts one signed by the key identity
 * rotated away from while it is still published. Composition is
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
const IDENTITY = '00000000-0000-4000-8000-0000000000d1';
const SESSION = '00000000-0000-4000-8000-0000000000e1';

/** A private key as identity is configured with it, its CryptoKey, and its thumbprint. */
async function jwkPair(): Promise<{ jwk: JWK; key: CryptoKey; kid: string }> {
  const pair = await generateKeyPair('ES256', { extractable: true });
  const jwk = await exportJWK(pair.privateKey);
  const { kty, crv, x, y } = jwk;
  return {
    jwk,
    key: (await importJWK(jwk, 'ES256')) as CryptoKey,
    kid: await calculateJwkThumbprint({ kty, crv, x, y } as JWK),
  };
}

let stopPg: (() => Promise<void>) | undefined;
const clients: ReturnType<typeof postgres>[] = [];
const servers: Server[] = [];
let router: Awaited<ReturnType<typeof startCosmoRouter>> | undefined;
let dir = '';
let url = '';
let privateKey: CryptoKey;
let previousKey: CryptoKey;
let kid = '';
let previousKid = '';
let identityUrl = '';
let peopleUrl = '';
let identity: ChildProcess | undefined;
const identityLog: string[] = [];
const AUDIENCE = 'kithena-router';
const ISSUER = 'https://auth.router.test';

const listen = (server: Server): Promise<number> =>
  new Promise((resolve) => {
    server.listen(0, '0.0.0.0', () => {
      resolve((server.address() as AddressInfo).port);
    });
  });

/** A token signed with identity's own key, shaped as identity shapes them. */
async function token(
  claims: Record<string, unknown> = {},
  options: { key?: CryptoKey; kid?: string; expires?: string | number } = {},
): Promise<string> {
  return new SignJWT({ sub: ADA_ACCOUNT, tid: ACME, iss: ISSUER, aud: AUDIENCE, ...claims })
    .setProtectedHeader({ alg: 'ES256', kid: options.kid ?? kid, typ: 'at+jwt' })
    .setIssuedAt()
    .setExpirationTime(options.expires ?? '2m')
    .sign(options.key ?? privateKey);
}

/** What the tenant app's server does (PEO-113): exchange its session for a token. */
async function issued(sessionId: string): Promise<Response> {
  return fetch(`${identityUrl}/api/internal/session/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-internal-token': TOKEN },
    body: JSON.stringify({ sessionId, tenantId: ACME }),
  });
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
  // Every migration: identity runs against the same database here (PEO-113),
  // with the service roles `tools/scripts/init-db.sql` creates first.
  for (const role of ['svc_identity', 'svc_messaging']) {
    await admin.unsafe(`CREATE ROLE ${role} NOLOGIN NOBYPASSRLS`);
  }
  const migrations = join(ROOT, 'migrations');
  for (const file of (await readdir(migrations)).filter((f) => f.endsWith('.sql')).sort()) {
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
  delete process.env['OPENFGA_URL'];
  process.env['PEOPLE_DATABASE_URL'] = asService.toString();
  process.env['PEOPLE_API_TOKEN'] = TOKEN;
  process.env['PEOPLE_SECRET_KEYS'] = `k1:${randomBytes(32).toString('base64')}`;
  const yoga = createYoga(yogaOptions);
  const people = createServer((request, response) => {
    void yoga(request, response);
  });
  wirePeople(people);
  servers.push(people);
  const peoplePort = await listen(people);
  peopleUrl = `http://127.0.0.1:${String(peoplePort)}`;

  // Identity, as `main.ts` runs it: signing with one key and still publishing
  // the one it rotated away from (PEO-113). The test keeps both private halves
  // only to mint the expired and wrong-audience tokens identity would never
  // issue itself; the kid is the thumbprint identity derives.
  const signing = await jwkPair();
  const previous = await jwkPair();
  privateKey = signing.key;
  previousKey = previous.key;
  kid = signing.kid;
  previousKid = previous.kid;
  // A free port for identity: bound, read, released.
  const probe = createServer();
  const identityPort = await listen(probe);
  await new Promise((resolve) => probe.close(resolve));
  identity = spawn(
    join(ROOT, 'node_modules/.bin/tsx'),
    [join(ROOT, 'platform/identity/src/main.ts')],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        IDENTITY_PORT: String(identityPort),
        IDENTITY_DATABASE_URL: pg.url,
        INTERNAL_API_TOKEN: TOKEN,
        AUTH_SIGNING_KEY: JSON.stringify(signing.jwk),
        AUTH_VERIFICATION_KEYS: JSON.stringify([previous.jwk]),
        AUTH_ISSUER: ISSUER,
        AUTH_TOKEN_AUDIENCE: AUDIENCE,
        KITHENA_ENTITLEMENTS: '["module.people"]',
        LOG_LEVEL: 'warn',
      },
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const keep = (chunk: Buffer) => identityLog.push(chunk.toString());
  identity.stdout?.on('data', keep);
  identity.stderr?.on('data', keep);
  identityUrl = `http://127.0.0.1:${String(identityPort)}`;
  const deadline = Date.now() + 60_000;
  while (
    !(await fetch(`${identityUrl}/.well-known/jwks.json`).then(
      (r) => r.ok,
      () => false,
    ))
  ) {
    if (Date.now() > deadline) throw new Error(`identity did not start\n${identityLog.join('')}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  // Ada's account and a live session, as a passkey sign-in leaves them.
  await admin`INSERT INTO platform.tenant (id, slug, display_name) VALUES (${ACME}, 'acme', 'Acme')`;
  await admin`INSERT INTO platform.identity (id) VALUES (${IDENTITY})`;
  await admin`INSERT INTO platform.account (id, tenant_id, identity_id, status, work_email, time_zone, employment_start, session_limit)
              VALUES (${ADA_ACCOUNT}, ${ACME}, ${IDENTITY}, 'active', 'ada@acme.example', 'Europe/Madrid', '2026-01-01', 4)`;
  await admin`INSERT INTO platform.session (id, tenant_id, account_id, slot, expires_at, amr)
              VALUES (${SESSION}, ${ACME}, ${ADA_ACCOUNT}, 1, now() + interval '1 day', ARRAY['hwk'])`;

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
      AUTH_JWKS_URL: `http://host.docker.internal:${String(identityPort)}/.well-known/jwks.json`,
      AUTH_TOKEN_AUDIENCE: AUDIENCE,
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
  if (identity?.pid !== undefined && identity.exitCode === null) {
    try {
      process.kill(-identity.pid, 'SIGKILL');
    } catch {
      // Already gone.
    }
  }
  for (const server of servers) await new Promise((resolve) => server.close(resolve));
  for (const client of clients) await client.end();
  await stopPg?.();
  if (dir !== '') await rm(dir, { recursive: true, force: true });
});

describe('the tenant app’s token, through the router (PEO-113)', () => {
  it('reads as the person whose session identity issued the token for', async () => {
    const answer = await issued(SESSION);
    expect(answer.status, identityLog.join('')).toBe(200);
    const { accessToken } = (await answer.json()) as { accessToken: string };
    const response = await ask({ authorization: `Bearer ${accessToken}` });
    const body = (await response.json()) as {
      data?: { person: { attributes: unknown[] } };
      errors?: unknown;
    };
    expect(JSON.stringify(body.errors ?? null)).toBe('null');
    expect(body.data?.person.attributes).toEqual([{ key: 'job_title', value: 'Engineer' }]);
  });

  it('issues nothing for a session that is not live', async () => {
    expect((await issued(randomUUID())).status).toBe(401);
  });

  it('refuses a token that has expired', async () => {
    const expired = await token({}, { expires: Math.floor(Date.now() / 1000) - 60 });
    expect((await ask({ authorization: `Bearer ${expired}` })).status).toBe(401);
  });

  it('refuses a token minted for another audience', async () => {
    const elsewhere = await token({ aud: 'some-other-api' });
    expect((await ask({ authorization: `Bearer ${elsewhere}` })).status).toBe(401);
  });

  it('accepts a token from the key identity rotated away from, while it is published', async () => {
    const before = await token({}, { key: previousKey, kid: previousKid });
    const response = await ask({ authorization: `Bearer ${before}` });
    expect(response.status).toBe(200);
  });

  it('is the only way in: People refuses the token itself, without the router', async () => {
    const answer = await issued(SESSION);
    const { accessToken } = (await answer.json()) as { accessToken: string };
    const direct = await fetch(`${peopleUrl}/v1/people/${ADA}`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(direct.status).toBe(401);
  });
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
