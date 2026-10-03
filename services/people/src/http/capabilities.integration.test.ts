import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { createYoga } from 'graphql-yoga';
import { PeopleFind, RuntimeCatalogue } from '@kithena/contracts';
import { startPostgres } from '@kithena/testing';

import { define, versionOf } from '../application/person/in-memory.js';
import { Person } from '../domain/person/person.js';
import { yogaOptions } from '../graphql/schema.js';
import { drizzlePersonRepository } from '../infrastructure/drizzle-person-repository.js';
import { drizzleSchemaRepository } from '../infrastructure/drizzle-schema-repository.js';
import { tenantTransaction } from '../infrastructure/unit-of-work.js';
import { wirePeople } from './server.js';

/**
 * People's capability routes, booted as `main.ts` boots People (AST-018): the
 * assistant's token opens them and nothing else, the router's opens
 * everything else and not them, and each asker's catalogue is what they may
 * filter by.
 */

const ACME = '00000000-0000-4000-8000-00000000000a';
const ADA = '00000000-0000-4000-8000-0000000000a1';
const ADA_ACCOUNT = '00000000-0000-4000-8000-0000000000b1';
const MARCO = '00000000-0000-4000-8000-0000000000a2';
const MARCO_ACCOUNT = '00000000-0000-4000-8000-0000000000b2';
const LEFT = '00000000-0000-4000-8000-0000000000a3';
const ROUTER = 'router-secret';
const ASSISTANT = 'assistant-secret';

let stopPg: (() => Promise<void>) | undefined;
const clients: ReturnType<typeof postgres>[] = [];
let server: Server | undefined;
let base = '';

const headers = (
  token: string,
  account: string,
  roles: string[] = [],
  over: Record<string, unknown> = {},
): Record<string, string> => ({
  'content-type': 'application/json',
  'x-internal-token': token,
  'x-kithena-principal': JSON.stringify({
    userId: account,
    tenantId: ACME,
    roles,
    entitlements: ['module.people'],
    impersonatedBy: null,
    viewedBy: null,
    ...over,
  }),
});
const asHr = (token = ASSISTANT) => headers(token, ADA_ACCOUNT, ['hr']);
const asEmployee = (token = ASSISTANT) => headers(token, MARCO_ACCOUNT);

const catalogue = (h: Record<string, string>) =>
  fetch(`${base}/internal/capabilities`, { headers: h });
const call = (h: Record<string, string>, name: string, input: unknown) =>
  fetch(`${base}/internal/capabilities/${name}`, {
    method: 'POST',
    headers: h,
    body: JSON.stringify(input),
  });

beforeAll(async () => {
  const pg = await startPostgres();
  stopPg = pg.stop;
  const owner = postgres(pg.url, { max: 1, onnotice: () => {} });
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
  const inTenant = tenantTransaction(drizzle(service));

  const repo = drizzlePersonRepository();
  const seed = (
    id: string,
    account: string | null,
    custom: Record<string, unknown>,
    name: { givenName: string; familyName: string },
    status: 'active' | 'terminated' = 'active',
  ) =>
    inTenant(ACME, ({ tx }) =>
      repo.create(
        tx,
        Person.rehydrate({
          id,
          tenantId: ACME,
          status,
          identityAccountId: account,
          hireDate: '2026-01-01',
          lastWorkingDay: null,
        }),
        { custom, ...name },
      ),
    );
  await seed(
    ADA,
    ADA_ACCOUNT,
    { job_title: 'People lead', department: 'people' },
    {
      givenName: 'Ada',
      familyName: 'Lovelace',
    },
  );
  await seed(
    MARCO,
    MARCO_ACCOUNT,
    { job_title: 'Engineer', department: 'engineering' },
    {
      givenName: 'Marco',
      familyName: 'Ruiz',
    },
  );
  await seed(
    LEFT,
    null,
    { job_title: 'Engineer', department: 'engineering' },
    { givenName: 'Lena', familyName: 'Gone' },
    'terminated',
  );
  const everyone = ['self', 'manager', 'manager_chain', 'hr', 'directory'] as const;
  await inTenant(ACME, ({ tx }) =>
    drizzleSchemaRepository().appendVersion(
      tx,
      ACME,
      versionOf(1, [
        define({ key: 'given_name', visibility: [...everyone] }),
        define({ key: 'family_name', visibility: [...everyone] }),
        define({ key: 'job_title', label: { default: 'Job title' }, visibility: [...everyone] }),
        define({
          key: 'department',
          label: { default: 'Department' },
          dataType: 'select',
          typeConfig: {
            kind: 'select',
            options: [
              { value: 'engineering', label: { default: 'Engineering' }, retiredAt: null },
              { value: 'people', label: { default: 'People' }, retiredAt: null },
            ],
          },
          visibility: [...everyone],
          indexed: true,
        }),
        // HR's alone: HR filters by it, nobody else does.
        define({ key: 'pay_band', label: { default: 'Pay band' }, visibility: ['hr'] }),
        // Never for a model: not a field in anybody's catalogue, and denied.
        define({
          key: 'disability',
          label: { default: 'Disability' },
          visibility: ['self', 'hr'],
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

  process.env['PEOPLE_DATABASE_URL'] = asService.toString();
  process.env['PEOPLE_API_TOKEN'] = ROUTER;
  process.env['ASSISTANT_PEOPLE_TOKEN'] = ASSISTANT;
  process.env['PEOPLE_SECRET_KEYS'] = `k1:${randomBytes(32).toString('base64')}`;
  const yoga = createYoga(yogaOptions);
  server = createServer((request, response) => {
    void yoga(request, response);
  });
  wirePeople(server);
  await new Promise<void>((resolve) => server?.listen(0, resolve));
  base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
}, 240_000);

afterAll(async () => {
  if (server !== undefined) await new Promise((resolve) => server?.close(resolve));
  for (const c of clients) await c.end();
  await stopPg?.();
});

describe('the catalogue', () => {
  it('is what each asker may filter by: HR’s and an employee’s differ as their fields do', async () => {
    const hr = RuntimeCatalogue.parse(await (await catalogue(asHr())).json());
    const employee = RuntimeCatalogue.parse(await (await catalogue(asEmployee())).json());
    const keys = (c: RuntimeCatalogue) => (c.fields['people.find'] ?? []).map((f) => f.key);
    expect(keys(hr)).toEqual(
      expect.arrayContaining(['job_title', 'department', 'pay_band', 'status']),
    );
    expect(keys(employee)).toEqual(expect.arrayContaining(['job_title', 'department']));
    expect(keys(employee)).not.toContain('pay_band');
    expect(keys(employee)).not.toContain('status');
    // Configuration, never a value: the options are the field's own.
    expect(hr.fields['people.find']?.find((f) => f.key === 'department')?.options).toEqual([
      { value: 'engineering', label: 'Engineering' },
      { value: 'people', label: 'People' },
    ]);
    for (const c of [hr, employee]) {
      expect(c.serves.map((s) => s.name)).toEqual([
        'people.find',
        'people.person',
        'people.reports',
        'people.managers',
        'people.approvals',
      ]);
      expect(keys(c)).not.toContain('disability');
      expect(c.denied).toContainEqual({ key: 'disability', labels: ['Disability'] });
      expect(c.module).toBe('people');
    }
    expect(JSON.stringify([hr, employee])).not.toMatch(/Lovelace|Ruiz|People lead/u);
  });
});

describe('the assistant’s token', () => {
  it('is the only one these routes take: the router’s is refused here', async () => {
    expect((await catalogue(asHr(ROUTER))).status).toBe(401);
    expect((await call(asHr(ROUTER), 'people.find', { limit: 0 })).status).toBe(401);
    expect((await catalogue(asHr('not-a-token'))).status).toBe(401);
  });

  it('opens nothing else: not GraphQL, not REST', async () => {
    const graphql = await fetch(`${base}/graphql`, {
      method: 'POST',
      headers: asHr(),
      body: JSON.stringify({
        query: 'query ($id: ID!) { person(id: $id) { id } }',
        variables: { id: ADA },
      }),
    });
    const answered = (await graphql.json()) as {
      data?: { person?: unknown } | null;
      errors?: { extensions?: { code?: string } }[];
    };
    expect(answered.data?.person ?? null).toBeNull();
    expect(answered.errors?.[0]?.extensions?.code).toBe('UNAUTHENTICATED');
    expect((await fetch(`${base}/v1/people`, { headers: asHr() })).status).toBe(401);
  });

  it('asks as a person, never as support or a view', async () => {
    const support = headers(ASSISTANT, ADA_ACCOUNT, [], {
      impersonatedBy: '00000000-0000-4000-8000-0000000000c1',
    });
    const viewing = headers(ASSISTANT, MARCO_ACCOUNT, [], { viewedBy: ADA_ACCOUNT });
    expect((await catalogue(support)).status).toBe(401);
    expect((await catalogue(viewing)).status).toBe(401);
  });
});

describe('people.find, in Postgres', () => {
  const find = async (h: Record<string, string>, input: unknown) => {
    const response = await call(h, 'people.find', input);
    expect(response.status).toBe(200);
    const out = PeopleFind.schemas.output.parse(await response.json());
    if (out.kind !== 'people') throw new Error(out.kind);
    return out;
  };

  it('runs the filters as the directory does', async () => {
    const out = await find(asEmployee(), {
      filters: [{ key: 'department', op: 'in', values: ['Engineering'] }],
      limit: 25,
    });
    expect(out.rows.map((r) => r.name)).toEqual(['Marco Ruiz']);
    expect(out.total).toBe(1);
  });

  it('narrowed to personIds, never returns somebody the asker could not list without them', async () => {
    const employee = await find(asEmployee(), {
      personIds: [ADA, MARCO, LEFT],
      limit: 25,
      ids: true,
    });
    expect(employee.ids?.toSorted()).toEqual([ADA, MARCO].toSorted());
    expect(employee.total).toBe(2);
    // HR's directory holds leavers, with or without the join.
    const hr = await find(asHr(), {
      personIds: [LEFT, ADA],
      filters: [{ key: 'department', op: 'in', values: ['engineering'] }],
      limit: 25,
    });
    expect(hr.rows.map((r) => r.personId)).toEqual([LEFT]);
    expect((await find(asHr(), { personIds: [], limit: 0 })).total).toBe(0);
  });
});
