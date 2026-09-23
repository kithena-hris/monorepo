import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { createYoga } from 'graphql-yoga';
import { startPostgres } from '@kithena/testing';

import { define, versionOf } from '../application/person/in-memory.js';
import { Person } from '../domain/person/person.js';
import { schema } from '../graphql/schema.js';
import { drizzlePersonRepository } from '../infrastructure/drizzle-person-repository.js';
import { drizzleSchemaRepository } from '../infrastructure/drizzle-schema-repository.js';
import { tenantTransaction } from '../infrastructure/unit-of-work.js';
import { wirePeople } from './server.js';

/**
 * The composition root, booted the way `main.ts` boots it, over Postgres:
 * one port, REST in front of Yoga, the caller taken from the router's
 * headers.
 */

const ACME = '00000000-0000-4000-8000-00000000000a';
const ADA = '00000000-0000-4000-8000-0000000000a1';
const MARCO = '00000000-0000-4000-8000-0000000000a2';
const MARCO_ACCOUNT = '00000000-0000-4000-8000-0000000000b2';
const HR_ACCOUNT = '00000000-0000-4000-8000-0000000000b3';

let stopPg: (() => Promise<void>) | undefined;
const clients: ReturnType<typeof postgres>[] = [];
let server: Server;
let base = '';

const headers = (account: string, roles: string[] = []) => ({
  'content-type': 'application/json',
  'x-internal-token': 'router-secret',
  'x-kithena-principal': JSON.stringify({
    userId: account,
    tenantId: ACME,
    roles,
    entitlements: ['module.people'],
  }),
});

const migration = (file: string): Promise<string> =>
  readFile(new URL(`../../../../migrations/${file}`, import.meta.url), 'utf8');

beforeAll(async () => {
  const pg = await startPostgres();
  stopPg = pg.stop;
  const adminClient = postgres(pg.url, { max: 1 });
  clients.push(adminClient);
  const admin = drizzle(adminClient);
  for (const file of [
    '20260821120000_tenant_registry.sql',
    '20260922140000_people_bootstrap.sql',
    '20260922160000_people_registry.sql',
    '20260922170000_people_person.sql',
    '20260923110000_people_completeness.sql',
    '20260923120000_people_webhooks.sql',
    '20260924170000_people_calendar.sql',
    '20260924170100_people_tenant_company.sql',
    '20260924230100_people_entitlements.sql',
    '20260924230200_people_role_grant.sql',
  ]) {
    await admin.execute(sql.raw(await migration(file)));
  }
  await admin.execute(sql`ALTER ROLE svc_people LOGIN PASSWORD 'svc_people'`);
  const asService = new URL(pg.url);
  asService.username = 'svc_people';
  asService.password = 'svc_people';

  const serviceClient = postgres(asService.toString(), { max: 2 });
  clients.push(serviceClient);
  const inTenant = tenantTransaction(drizzle(serviceClient));
  const repo = drizzlePersonRepository();
  const seed = (id: string, account: string | null, managerId: string | null) =>
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
        { managerId },
      ),
    );
  await seed(MARCO, MARCO_ACCOUNT, null);
  await seed(ADA, null, MARCO);
  await inTenant(ACME, ({ tx }) =>
    drizzleSchemaRepository().appendVersion(
      tx,
      ACME,
      versionOf(1, [
        define({
          key: 'base_salary',
          dataType: 'money',
          typeConfig: { kind: 'money' },
          visibility: ['hr'],
          classification: {
            classification: 'confidential',
            piiKind: 'none',
            exportable: true,
            aiEligible: false,
          },
        }),
        define({ key: 'job_title', visibility: ['manager', 'hr'] }),
      ]),
      [],
      '2026-09-01',
    ),
  );

  process.env['PEOPLE_DATABASE_URL'] = asService.toString();
  process.env['PEOPLE_API_TOKEN'] = 'router-secret';
  process.env['PEOPLE_SECRET_KEYS'] = `k1:${randomBytes(32).toString('base64')}`;

  const yoga = createYoga({ schema, graphqlEndpoint: '/graphql' });
  server = createServer((request, response) => {
    void yoga(request, response);
  });
  wirePeople(server);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  for (const c of clients) await c.end();
  await stopPg?.();
});

describe('the booted service', () => {
  it('writes over REST, idempotently, and reads back through GraphQL as the manager', async () => {
    const patch = () =>
      fetch(`${base}/v1/people/${ADA}`, {
        method: 'PATCH',
        headers: { ...headers(HR_ACCOUNT, ['hr']), 'idempotency-key': 'first' },
        body: JSON.stringify({
          attributes: {
            base_salary: { amountMinor: 5_500_000, currency: 'EUR' },
            job_title: 'Engineer',
          },
        }),
      });
    const first = await patch();
    expect(first.status).toBe(200);
    expect(await (await patch()).json()).toEqual(await first.json());

    const graph = await fetch(`${base}/graphql`, {
      method: 'POST',
      headers: headers(MARCO_ACCOUNT),
      body: JSON.stringify({
        query: `{ person(id: "${ADA}") { attributes { ... on TextAttribute { key value } ... on MoneyAttribute { key } } } }`,
      }),
    });
    const body = (await graph.json()) as { data: { person: { attributes: unknown[] } } };
    expect(body.data.person.attributes).toEqual([{ key: 'job_title', value: 'Engineer' }]);
  });

  it('refuses a request that did not come through the router', async () => {
    const response = await fetch(`${base}/v1/people/${ADA}`, {
      headers: { 'x-kithena-principal': headers(HR_ACCOUNT, ['hr'])['x-kithena-principal'] },
    });
    expect(response.status).toBe(401);
  });

  it('refuses a company the back office recorded without People, whatever is forwarded (PEO-114)', async () => {
    const OTHER = '00000000-0000-4000-8000-00000000000b';
    const asOther = {
      ...headers(HR_ACCOUNT, ['hr']),
      'x-kithena-principal': JSON.stringify({
        userId: HR_ACCOUNT,
        tenantId: OTHER,
        roles: ['hr'],
        entitlements: ['module.people'],
      }),
    };
    const read = () => fetch(`${base}/v1/people`, { headers: asOther });
    expect((await read()).status).not.toBe(403);
    await clients[0]?.unsafe(
      `INSERT INTO people.tenant_settings (tenant_id, default_time_zone, cohort_minimum, entitlements, entitlements_as_of)
       VALUES ('${OTHER}', 'Etc/UTC', 10, ARRAY['module.timeoff'], now())`,
    );
    const refused = await read();
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ error: { code: 'NOT_ENTITLED' } });
  });

  it('grants and revokes roles over REST and GraphQL, idempotently, by the rules (PEO-112)', async () => {
    await clients[0]?.unsafe(
      `INSERT INTO people.role_grant (tenant_id, account_id, role) VALUES ('${ACME}', '${HR_ACCOUNT}', 'people_admin')`,
    );
    const post = (path: string, body: unknown, key: string | null, as = HR_ACCOUNT) =>
      fetch(`${base}/v1/roles/${path}`, {
        method: 'POST',
        headers: { ...headers(as), ...(key === null ? {} : { 'idempotency-key': key }) },
        body: JSON.stringify(body),
      });
    const finance = { accountId: MARCO_ACCOUNT, role: 'finance', reason: 'Runs payroll' };

    expect((await post('grants', finance, null)).status).toBe(422);
    const granted = await post('grants', finance, 'grant-1');
    expect(granted.status).toBe(200);
    expect(await granted.json()).toEqual({ accountId: MARCO_ACCOUNT, roles: ['finance'] });
    expect(await (await post('grants', finance, 'grant-1')).json()).toEqual({
      accountId: MARCO_ACCOUNT,
      roles: ['finance'],
    });

    const self = await post('grants', { ...finance, accountId: HR_ACCOUNT }, 'self-1');
    expect(self.status).toBe(403);
    expect(await self.json()).toMatchObject({ error: { code: 'SELF_GRANT' } });
    const byMarco = await post('grants', { ...finance, role: 'hr' }, 'marco-1', MARCO_ACCOUNT);
    expect(byMarco.status).toBe(403);
    const last = await post(
      'revocations',
      { accountId: HR_ACCOUNT, role: 'people_admin', reason: 'Leaving' },
      'last-1',
    );
    expect(last.status).toBe(409);
    expect(await last.json()).toMatchObject({ error: { code: 'LAST_ADMIN' } });

    const graph = await fetch(`${base}/graphql`, {
      method: 'POST',
      headers: headers(HR_ACCOUNT),
      body: JSON.stringify({
        query: `mutation { revokeRole(accountId: "${MARCO_ACCOUNT}", role: finance, reason: "Moved team") { accountId roles } }`,
      }),
    });
    expect(await graph.json()).toEqual({
      data: { revokeRole: { accountId: MARCO_ACCOUNT, roles: [] } },
    });
    const listed = await fetch(`${base}/v1/roles`, { headers: headers(HR_ACCOUNT) });
    expect(await listed.json()).toEqual({
      items: [{ accountId: HR_ACCOUNT, roles: ['people_admin'] }],
    });
    const events = await clients[0]?.unsafe<{ event_name: string; reason: string }[]>(
      `SELECT event_name, envelope -> 'payload' ->> 'reason' AS reason FROM people.outbox
        WHERE event_name LIKE 'people.role.%' ORDER BY created_at, event_id`,
    );
    expect(events?.map((e) => [e.event_name, e.reason])).toEqual([
      ['people.role.granted', 'Runs payroll'],
      ['people.role.revoked', 'Moved team'],
    ]);
  });

  it('serves its OpenAPI document', async () => {
    const response = await fetch(`${base}/v1/openapi.json`);
    const doc = (await response.json()) as { openapi: string; paths: Record<string, unknown> };
    expect(doc.openapi).toBe('3.1.0');
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining(['/v1/roles', '/v1/roles/grants', '/v1/roles/revocations']),
    );
  });
});
