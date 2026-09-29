import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { createYoga } from 'graphql-yoga';
import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { startObjectStore, startPostgres } from '@kithena/testing';

import { define, versionOf } from '../application/person/in-memory.js';
import { uuidv7 } from '../application/person/ids.js';
import { Person } from '../domain/person/person.js';
import { yogaOptions } from '../graphql/schema.js';
import { peopleConsumer } from '../infrastructure/consumers/handle.js';
import { drizzlePersonRepository } from '../infrastructure/drizzle-person-repository.js';
import { drizzleSchemaRepository } from '../infrastructure/drizzle-schema-repository.js';
import {
  isViewOnlyRefusal,
  readOnly,
  tenantTransaction,
  type InTenantTransaction,
} from '../infrastructure/unit-of-work.js';
import { wirePeople } from './server.js';

/**
 * Viewing as an employee, in People, booted as `main.ts` boots it: who may
 * start one, what identity is told, that the view is the employee's own, and
 * that nothing — over REST, GraphQL, SCIM or a background job — is written
 * while it lasts.
 */

const ACME = '00000000-0000-4000-8000-00000000000a';
const ADMIN = '00000000-0000-4000-8000-0000000000a1';
const ADMIN_ACCOUNT = '00000000-0000-4000-8000-0000000000b1';
const MARCO = '00000000-0000-4000-8000-0000000000a2';
const MARCO_ACCOUNT = '00000000-0000-4000-8000-0000000000b2';
const OTHER_ADMIN = '00000000-0000-4000-8000-0000000000a3';
const OTHER_ADMIN_ACCOUNT = '00000000-0000-4000-8000-0000000000b3';
const ADA = '00000000-0000-4000-8000-0000000000a4';
const HR_ACCOUNT = '00000000-0000-4000-8000-0000000000b5';
const OPERATOR = '00000000-0000-4000-8000-0000000000c1';
const TOKEN = 'router-secret';

let stopPg: (() => Promise<void>) | undefined;
let stopObjects: (() => Promise<void>) | undefined;
const clients: ReturnType<typeof postgres>[] = [];
const servers: Server[] = [];
let base = '';
let inTenant: InTenantTransaction;
let owner: ReturnType<typeof postgres>;
/** What People asked identity, in order. */
const asked: Record<string, unknown>[] = [];

type Principal = {
  roles?: string[];
  impersonatedBy?: string | null;
  viewedBy?: string | null;
};

const headers = (account: string, p: Principal = {}): Record<string, string> => ({
  'content-type': 'application/json',
  'x-internal-token': TOKEN,
  'x-kithena-principal': JSON.stringify({
    userId: account,
    tenantId: ACME,
    roles: p.roles ?? [],
    entitlements: ['module.people'],
    impersonatedBy: p.impersonatedBy ?? null,
    viewedBy: p.viewedBy ?? null,
  }),
});
/** Marco's own view, as an administrator viewing as him sees it. */
const viewing = () => headers(MARCO_ACCOUNT, { viewedBy: ADMIN_ACCOUNT });
const asAdmin = () => headers(ADMIN_ACCOUNT, { roles: ['people_admin'] });

async function graph(
  h: Record<string, string>,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<{ data?: Record<string, unknown> | null; errors?: { extensions?: { code?: string } }[] }> {
  const response = await fetch(`${base}/graphql`, {
    method: 'POST',
    headers: h,
    body: JSON.stringify({ query, variables }),
  });
  return (await response.json()) as never;
}

const START = `mutation ($personId: ID!, $reason: String!) {
  startViewingAs(personId: $personId, reason: $reason) { code expiresAt }
}`;
const start = (h: Record<string, string>, personId = MARCO, reason = 'Payslip question') =>
  graph(h, START, { personId, reason });
const code = (answer: Awaited<ReturnType<typeof graph>>) => answer.errors?.[0]?.extensions?.code;

beforeAll(async () => {
  const [pg, objects] = await Promise.all([startPostgres(), startObjectStore()]);
  stopPg = pg.stop;
  stopObjects = objects.stop;
  await new S3Client({
    endpoint: objects.endpoint,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId: objects.accessKeyId, secretAccessKey: objects.secretAccessKey },
  }).send(new CreateBucketCommand({ Bucket: 'uploads' }));
  process.env['PEOPLE_UPLOAD_BUCKET'] = 'uploads';
  process.env['PEOPLE_UPLOAD_S3_ENDPOINT'] = objects.endpoint;
  process.env['PEOPLE_UPLOAD_S3_ACCESS_KEY_ID'] = objects.accessKeyId;
  process.env['PEOPLE_UPLOAD_S3_SECRET_ACCESS_KEY'] = objects.secretAccessKey;

  owner = postgres(pg.url, { max: 1, onnotice: () => {} });
  clients.push(owner);
  for (const role of ['svc_identity', 'svc_messaging', 'svc_slack']) {
    await owner.unsafe(`CREATE ROLE ${role} NOLOGIN NOBYPASSRLS`);
  }
  const migrations = new URL('../../../../migrations/', import.meta.url);
  for (const file of (await readdir(migrations)).filter((f) => f.endsWith('.sql')).sort()) {
    await drizzle(owner).execute(sql.raw(await readFile(new URL(file, migrations), 'utf8')));
  }
  await owner`ALTER ROLE svc_people LOGIN PASSWORD 'svc_people'`;
  const asService = new URL(pg.url);
  asService.username = 'svc_people';
  asService.password = 'svc_people';
  const service = postgres(asService.toString(), { max: 2 });
  clients.push(service);
  inTenant = tenantTransaction(drizzle(service));

  const repo = drizzlePersonRepository();
  const seed = (
    id: string,
    account: string | null,
    custom: Record<string, unknown> = {},
    name: { givenName?: string; familyName?: string } = {},
  ) =>
    inTenant(ACME, ({ tx }) =>
      repo.create(
        tx,
        Person.rehydrate({
          id,
          tenantId: ACME,
          status: 'active',
          identityAccountId: account,
          hireDate: '2026-01-01',
          lastWorkingDay: null,
        }),
        { custom, ...name },
      ),
    );
  await seed(ADMIN, ADMIN_ACCOUNT, { job_title: 'People lead' }, {
    givenName: 'Grace',
    familyName: 'Hopper',
  });
  await seed(MARCO, MARCO_ACCOUNT, { job_title: 'Engineer', disability: 'Declared', pay_note: 'Band 4' });
  await seed(OTHER_ADMIN, OTHER_ADMIN_ACCOUNT);
  await seed(ADA, null);
  await owner`
    INSERT INTO people.role_grant (tenant_id, account_id, role) VALUES
      (${ACME}::uuid, ${ADMIN_ACCOUNT}::uuid, 'people_admin'),
      (${ACME}::uuid, ${OTHER_ADMIN_ACCOUNT}::uuid, 'people_admin')`;
  await inTenant(ACME, ({ tx }) =>
    drizzleSchemaRepository().appendVersion(
      tx,
      ACME,
      versionOf(1, [
        define({ key: 'job_title', visibility: ['self', 'hr', 'directory'], ownership: ['employee', 'hr'] }),
        // Only HR: the employee never reads it, so neither does a view as them.
        define({ key: 'pay_note', visibility: ['hr'] }),
        define({
          key: 'disability',
          visibility: ['self', 'hr'],
          ownership: ['employee'],
          classification: {
            classification: 'special-category',
            piiKind: 'health',
            exportable: false,
            aiEligible: false,
          },
        }),
      ]),
      [],
      '2026-09-01',
    ),
  );

  // Identity, as far as People sees it: the start, and a handoff code back.
  const identity = createServer((request, response) => {
    let body = '';
    request.on('data', (c: Buffer) => (body += c.toString()));
    request.on('end', () => {
      asked.push({
        path: request.url,
        token: request.headers['x-internal-token'],
        ...(JSON.parse(body) as Record<string, unknown>),
      });
      response
        .writeHead(201, { 'content-type': 'application/json' })
        .end(JSON.stringify({ code: 'handoff-code', expiresAt: '2026-09-29T10:30:00.000Z' }));
    });
  });
  servers.push(identity);
  await new Promise<void>((resolve) => identity.listen(0, '127.0.0.1', resolve));
  process.env['IDENTITY_URL'] = `http://127.0.0.1:${String((identity.address() as AddressInfo).port)}`;
  process.env['PEOPLE_IDENTITY_TOKEN'] = 'people-to-identity';

  process.env['PEOPLE_DATABASE_URL'] = asService.toString();
  process.env['PEOPLE_API_TOKEN'] = TOKEN;
  process.env['PEOPLE_SECRET_KEYS'] = `k1:${randomBytes(32).toString('base64')}`;
  const yoga = createYoga(yogaOptions);
  const server = createServer((request, response) => {
    void yoga(request, response);
  });
  servers.push(server);
  wirePeople(server);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
}, 240_000);

afterAll(async () => {
  for (const s of servers) await new Promise((resolve) => s.close(resolve));
  for (const c of clients) await c.end();
  await stopPg?.();
  await stopObjects?.();
});

describe('starting to view as somebody', () => {
  it('is a People administrator’s, and identity is told who, whom, why and what was visible', async () => {
    const before = asked.length;
    const answer = await start(asAdmin());
    expect(answer.errors).toBeUndefined();
    expect(answer.data?.['startViewingAs']).toEqual({
      code: 'handoff-code',
      expiresAt: '2026-09-29T10:30:00.000Z',
    });
    expect(asked.slice(before)).toEqual([
      {
        path: '/api/internal/view-as/start',
        token: 'people-to-identity',
        tenantId: ACME,
        adminAccountId: ADMIN_ACCOUNT,
        subjectAccountId: MARCO_ACCOUNT,
        reason: 'Payslip question',
        // Marco reads his own disability, and has one on file.
        specialCategory: true,
      },
    ]);
  });

  it('is nobody else’s: not HR’s, not finance’s, not Kithena support’s', async () => {
    const before = asked.length;
    expect(code(await start(headers(HR_ACCOUNT, { roles: ['hr'] })))).toBe('FORBIDDEN');
    expect(code(await start(headers(HR_ACCOUNT, { roles: ['finance'] })))).toBe('FORBIDDEN');
    expect(code(await start(headers(MARCO_ACCOUNT)))).toBe('FORBIDDEN');
    const support = headers('00000000-0000-4000-8000-0000000000d9', { impersonatedBy: OPERATOR });
    expect(code(await start(support))).toBe('FORBIDDEN');
    expect(asked.length).toBe(before);
  });

  it('is never of another administrator, oneself, or somebody who cannot sign in', async () => {
    const before = asked.length;
    expect(code(await start(asAdmin(), OTHER_ADMIN))).toBe('VIEW_AS_ADMINISTRATOR');
    expect(code(await start(asAdmin(), ADMIN))).toBe('VIEW_AS_SELF');
    expect(code(await start(asAdmin(), ADA))).toBe('VIEW_AS_NO_ACCOUNT');
    expect(code(await start(asAdmin(), MARCO, '   '))).toBe('REASON_REQUIRED');
    expect(asked.length).toBe(before);
  });

  it('cannot be started from inside a view', async () => {
    const before = asked.length;
    // Even claiming an administrator's roles: the view is read-only first.
    const inside = headers(MARCO_ACCOUNT, { viewedBy: ADMIN_ACCOUNT, roles: ['people_admin'] });
    expect(code(await start(inside, ADA))).toBe('VIEW_ONLY');
    expect(asked.length).toBe(before);
  });

  it('is offered on the profile exactly where it would be allowed', async () => {
    const offered = async (h: Record<string, string>, personId: string) => {
      const response = await fetch(`${base}/v1/views/profile/${personId}`, { headers: h });
      return ((await response.json()) as { person: { canViewAs: boolean } }).person.canViewAs;
    };
    expect(await offered(asAdmin(), MARCO)).toBe(true);
    expect(await offered(asAdmin(), OTHER_ADMIN)).toBe(false);
    expect(await offered(asAdmin(), ADA)).toBe(false);
    expect(await offered(headers(HR_ACCOUNT, { roles: ['hr'] }), MARCO)).toBe(false);
  });

  it('refuses a principal claiming to be support and viewing at once', async () => {
    const both = headers(MARCO_ACCOUNT, { viewedBy: ADMIN_ACCOUNT, impersonatedBy: OPERATOR });
    expect((await fetch(`${base}/v1/people/${MARCO}`, { headers: both })).status).toBe(401);
  });
});

describe('while viewing as somebody', () => {
  it('reads what they read of themselves, special-category data included, and nothing more', async () => {
    const response = await fetch(`${base}/v1/people/${MARCO}`, { headers: viewing() });
    expect(response.status).toBe(200);
    const { attributes } = (await response.json()) as { attributes: Record<string, unknown> };
    expect(attributes).toMatchObject({ job_title: 'Engineer', disability: 'Declared' });
    // HR's alone: the administrator would read it, Marco does not.
    expect(attributes).not.toHaveProperty('pay_note');
  });

  it('writes nothing over REST', async () => {
    const write = (method: string, path: string, body: unknown) =>
      fetch(`${base}${path}`, {
        method,
        headers: { ...viewing(), 'idempotency-key': randomUUID() },
        body: JSON.stringify(body),
      });
    for (const answer of [
      await write('PATCH', `/v1/people/${MARCO}`, { attributes: { job_title: 'Chief' } }),
      // A "safe" POST too: it would start an upload of their photo.
      await write('POST', '/v1/views/photos/uploads', { personId: null, size: 1024 }),
      await write('POST', '/v1/views/me/sections', { changed: [{ key: 'job_title', text: 'Chief' }] }),
      await write('POST', '/v1/roles/grants', { accountId: HR_ACCOUNT, role: 'hr', reason: 'x' }),
    ]) {
      expect(answer.status).toBe(403);
      expect(((await answer.json()) as { error: { code: string } }).error.code).toBe('VIEW_ONLY');
    }
    const [row] = await owner<{ job_title: string }[]>`
      SELECT custom ->> 'job_title' AS job_title FROM people.person WHERE id = ${MARCO}::uuid`;
    expect(row?.job_title).toBe('Engineer');
  });

  it('writes nothing over GraphQL, whichever mutation', async () => {
    const granted = await graph(
      viewing(),
      `mutation { grantRole(accountId: "${HR_ACCOUNT}", role: hr, reason: "x", idempotencyKey: "k-1") { accountId } }`,
    );
    expect(code(granted)).toBe('VIEW_ONLY');
    expect(granted.data ?? null).toBeNull();
    const [grant] = await owner`
      SELECT 1 FROM people.role_grant WHERE account_id = ${HR_ACCOUNT}::uuid`;
    expect(grant).toBeUndefined();
  });

  it('starts no background job: an export is refused and nothing is queued', async () => {
    const response = await fetch(`${base}/v1/exports`, {
      method: 'POST',
      headers: { ...viewing(), 'idempotency-key': randomUUID() },
      body: JSON.stringify({ format: 'csv', reason: 'Audit' }),
    });
    expect(response.status).toBe(403);
    const [queued] = await owner`SELECT count(*)::int AS n FROM people.export`;
    expect(queued).toEqual({ n: 0 });
  });

  it('reaches no SCIM write: SCIM answers to its own tokens, never to a principal', async () => {
    const response = await fetch(`${base}/scim/v2/Users`, {
      method: 'POST',
      headers: { ...viewing(), 'content-type': 'application/scim+json' },
      body: JSON.stringify({ userName: 'x@acme.example' }),
    });
    expect(response.status).toBe(401);
  });

  it('holds even for a write no route refused: the transaction is read-only', async () => {
    const refused = await readOnly(() =>
      inTenant(ACME, ({ tx }) =>
        tx.execute(sql`UPDATE people.person SET custom = custom WHERE id = ${MARCO}::uuid`),
      ),
    ).catch((error: unknown) => error);
    expect(isViewOnlyRefusal(refused)).toBe(true);
    // And outside it, the same unit of work writes.
    await inTenant(ACME, ({ tx }) =>
      tx.execute(sql`UPDATE people.person SET custom = custom WHERE id = ${MARCO}::uuid`),
    );
  });
});

describe('telling the employee', () => {
  it('shows the view in their inbox once it is over, with who and whether special-category data showed', async () => {
    const handle = peopleConsumer({ inTenant, provisional: {} as never, recompute: {} as never });
    const session = randomUUID();
    const envelope = (eventName: string, occurredAt: string, payload: Record<string, unknown>) => ({
      eventId: uuidv7(),
      eventName,
      eventVersion: 1,
      tenantId: ACME,
      occurredAt,
      recordedAt: occurredAt,
      effectiveFrom: null,
      aggregate: { type: 'ViewAsSession', id: session, version: 1 },
      actor: { kind: 'user', userId: ADMIN_ACCOUNT },
      correlationId: randomUUID(),
      causationId: null,
      payload,
    });
    const startedAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const common = {
      sessionId: session,
      adminAccountId: ADMIN_ACCOUNT,
      subjectAccountId: MARCO_ACCOUNT,
      reason: 'Payslip question',
      specialCategory: true,
    };
    const inbox = async () => {
      const response = await fetch(`${base}/v1/views/overview`, { headers: headers(MARCO_ACCOUNT) });
      return ((await response.json()) as { viewedAs: Record<string, unknown>[] }).viewedAs;
    };

    expect(
      await handle(
        envelope('identity.view_as.started', startedAt, {
          ...common,
          expiresAt: new Date(Date.parse(startedAt) + 30 * 60 * 1000).toISOString(),
        }),
      ),
    ).toBe('applied');
    // Still going: not yet.
    expect(await inbox()).toEqual([]);

    const endedAt = new Date().toISOString();
    expect(
      await handle(
        envelope('identity.view_as.ended', endedAt, { ...common, startedAt, endedBy: 'admin' }),
      ),
    ).toBe('applied');
    expect(await inbox()).toEqual([
      {
        id: session,
        by: 'Grace Hopper',
        at: startedAt,
        endedAt,
        specialCategory: true,
      },
    ]);
    // Somebody else's inbox has nothing of it.
    const theirs = await fetch(`${base}/v1/views/overview`, { headers: asAdmin() });
    expect(((await theirs.json()) as { viewedAs: unknown[] }).viewedAs).toEqual([]);
  });
});
