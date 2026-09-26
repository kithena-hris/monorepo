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
import { yogaOptions } from '../graphql/schema.js';
import { drizzleSchemaRepository } from '../infrastructure/drizzle-schema-repository.js';
import { tenantTransaction } from '../infrastructure/unit-of-work.js';
import { wirePeople } from './server.js';

/**
 * Hiring somebody added without a start date, booted as `main.ts` boots
 * People, over Postgres: from their profile (`POST /v1/people/{id}/hire`,
 * placed first when they are placed nowhere) and a page at a time from bulk
 * edit (`/v1/views/bulk-hire`), each person atomic, the refused ones said why.
 *
 * The server's clock is the real one, so a start date in 2020 has begun and
 * one in 2099 has not.
 */

const ACME = '00000000-0000-4000-8000-00000000000a';
const ES = '00000000-0000-4000-8000-0000000000e1';
const MAD = '00000000-0000-4000-8000-0000000000d1';
const LENA = '00000000-0000-4000-8000-0000000000a1';
const OMAR = '00000000-0000-4000-8000-0000000000a2';
const PIA = '00000000-0000-4000-8000-0000000000a3';
const RUI = '00000000-0000-4000-8000-0000000000a4';
const ANA = '00000000-0000-4000-8000-0000000000a5';
const HR_ACCOUNT = '00000000-0000-4000-8000-0000000000b3';
const OTHER_ACCOUNT = '00000000-0000-4000-8000-0000000000b4';

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
const hr = headers(HR_ACCOUNT, ['hr']);

const migration = (file: string): Promise<string> =>
  readFile(new URL(`../../../../migrations/${file}`, import.meta.url), 'utf8');

const dated = (key: string, dataType: 'legal_entity_ref' | 'location_ref') =>
  define({ key, dataType, typeConfig: { kind: dataType }, effectiveDated: true });

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
    '20260926140000_people_visibility_rules.sql',
    '20260926180000_people_pending_change.sql',
    '20260922170000_people_person.sql',
    '20260924150000_people_unique_hash.sql',
    '20260924350000_people_unique_key_lookup.sql',
    '20260924220000_people_access_end.sql',
    '20260924220200_people_employment_period.sql',
    '20260923110000_people_completeness.sql',
    '20260923120000_people_webhooks.sql',
    '20260924170000_people_calendar.sql',
    '20260924170100_people_tenant_company.sql',
    '20260924200000_people_employee_numbering.sql',
    '20260924270100_people_entitlements.sql',
    '20260924270200_people_role_grant.sql',
    '20260924330000_people_identifier_review.sql',
    '20260926143000_people_duplicates.sql',
    '20260926160000_people_scim.sql',
    '20260924340000_people_person_key_lookup.sql',
    '20260924370000_people_directory_search.sql',
    '20260926120000_people_custom_filter.sql',
    '20260926130000_people_segment.sql',
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

  await admin.execute(sql`
    INSERT INTO people.legal_entity (tenant_id, id, name, country, time_zone)
    VALUES (${ACME}::uuid, ${ES}::uuid, 'Acme Spain', 'ES', 'Europe/Madrid')`);
  await admin.execute(sql`
    INSERT INTO people.location (tenant_id, id, legal_entity_id, name, country, archived_at)
    VALUES (${ACME}::uuid, ${MAD}::uuid, ${ES}::uuid, 'Madrid', 'ES', NULL)`);
  await admin.execute(sql`
    INSERT INTO people.location_zone (tenant_id, id, location_id, effective_from, time_zone)
    VALUES (${ACME}::uuid, gen_random_uuid(), ${MAD}::uuid, '2000-01-01', 'Europe/Madrid')`);
  await inTenant(ACME, ({ tx }) =>
    drizzleSchemaRepository().appendVersion(
      tx,
      ACME,
      versionOf(1, [
        define({ key: 'given_name' }),
        define({ key: 'family_name' }),
        define({ key: 'work_email' }),
        dated('legal_entity_id', 'legal_entity_ref'),
        dated('location_id', 'location_ref'),
      ]),
      [],
      '2000-01-01',
    ),
  );
  // Lena is placed nowhere; Omar and Pia are in Madrid; Rui was added
  // without a work email; Ana is already an employee.
  await admin.execute(sql`
    INSERT INTO people.person
      (tenant_id, id, status, hire_date, legal_entity_id, location_id,
       given_name, family_name, work_email, custom, schema_version)
    VALUES
      (${ACME}::uuid, ${LENA}::uuid, 'provisional', NULL, NULL, NULL,
       'Lena', 'Moreau', 'lena@acme.test', '{}'::jsonb, 1),
      (${ACME}::uuid, ${OMAR}::uuid, 'provisional', NULL, ${ES}::uuid, ${MAD}::uuid,
       'Omar', 'Haddad', 'omar@acme.test', '{}'::jsonb, 1),
      (${ACME}::uuid, ${PIA}::uuid, 'provisional', NULL, ${ES}::uuid, ${MAD}::uuid,
       'Pia', 'Lund', 'pia@acme.test', '{}'::jsonb, 1),
      (${ACME}::uuid, ${RUI}::uuid, 'provisional', NULL, ${ES}::uuid, ${MAD}::uuid,
       'Rui', 'Costa', NULL, '{}'::jsonb, 1),
      (${ACME}::uuid, ${ANA}::uuid, 'active', '2024-01-08', ${ES}::uuid, ${MAD}::uuid,
       'Ana', 'García', 'ana@acme.test', '{}'::jsonb, 1)`);
  await admin.execute(sql`
    INSERT INTO people.employment_period (tenant_id, person_id, period, legal_entity_id, started_on)
    VALUES (${ACME}::uuid, ${ANA}::uuid, 1, ${ES}::uuid, '2024-01-08')`);

  process.env['PEOPLE_DATABASE_URL'] = asService.toString();
  process.env['PEOPLE_API_TOKEN'] = 'router-secret';
  process.env['PEOPLE_SECRET_KEYS'] = `k1:${randomBytes(32).toString('base64')}`;

  const yoga = createYoga(yogaOptions);
  server = createServer((request, response) => {
    void yoga(request, response);
  });
  wirePeople(server);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});

afterAll(async () => {
  const listening = server as Server | undefined;
  if (listening) await new Promise((resolve) => listening.close(resolve));
  for (const c of clients) await c.end();
  await stopPg?.();
});

const post = async (path: string, body: unknown, key: string | null, as = hr) => {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { ...as, ...(key === null ? {} : { 'idempotency-key': key }) },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
};

const superuser = () => {
  const client = clients[0];
  if (client === undefined) throw new Error('the admin client is not connected');
  return client;
};

/** People's outbox for one person, in order: what it told the rest of the world. */
const events = async (personId: string) =>
  (
    await superuser().unsafe<{ event_name: string; envelope: { effectiveFrom: string | null } }[]>(
      `SELECT event_name, envelope FROM people.outbox
        WHERE aggregate_id = '${personId}' ORDER BY created_at, event_id`,
    )
  ).map((e) => [e.event_name, e.envelope.effectiveFrom]);

const counts = async () => {
  const response = await fetch(`${base}/v1/views/directory`, { headers: hr });
  const view = (await response.json()) as { total: number; active: number; notStarted: number };
  return [view.total, view.active, view.notStarted];
};

describe('hiring somebody added without a start date, from their profile', () => {
  it('is HR’s, needs a placement where there is one to give, and hires once per key', async () => {
    expect(await counts()).toEqual([5, 1, 4]);

    const notHr = await post(`/v1/people/${LENA}/hire`, { hireDate: '2020-03-02' }, 'p0', headers(OTHER_ACCOUNT));
    expect([notHr.status, (notHr.body['error'] as { code: string }).code]).toEqual([403, 'FORBIDDEN']);

    const unplaced = await post(`/v1/people/${LENA}/hire`, { hireDate: '2020-03-02' }, 'p1');
    expect(unplaced.body['error']).toMatchObject({ code: 'PLACEMENT_REQUIRED' });
    expect(await events(LENA)).toEqual([]);

    const hired = await post(
      `/v1/people/${LENA}/hire`,
      { hireDate: '2020-03-02', locationId: MAD },
      'p2',
    );
    expect(hired.status).toBe(200);
    expect(hired.body['status']).toBe('active');
    expect(hired.body['attributes']).toMatchObject({ legal_entity_id: ES, location_id: MAD });
    // Placed from the start date, then hired from it: both effective then, recorded now.
    const told = await events(LENA);
    expect(told).toContainEqual(['people.person.status_changed', '2020-03-02']);
    expect(told).toContainEqual(['people.person.hired', '2020-03-02']);

    const again = await post(
      `/v1/people/${LENA}/hire`,
      { hireDate: '2020-03-02', locationId: MAD },
      'p2',
    );
    expect(again).toEqual(hired);
    expect(await events(LENA)).toEqual(told);

    const twice = await post(`/v1/people/${LENA}/hire`, { hireDate: '2020-03-02' }, 'p3');
    expect(twice.status).toBe(409);
    expect(twice.body['error']).toMatchObject({ code: 'INVALID_TRANSITION' });

    expect(await counts()).toEqual([5, 2, 3]);
  });
});

describe('bulk hire', () => {
  type Row = { personId: string; outcome: string; refusal: { code: string; message: string } | null };
  const outcomes = (rows: Row[]) => rows.map((r) => [r.personId, r.outcome, r.refusal?.code ?? null]);
  const batch = {
    hires: [
      { personId: OMAR, hireDate: '2020-03-02' },
      { personId: PIA, hireDate: '2099-01-04' },
      { personId: RUI, hireDate: '2020-03-02' },
      { personId: ANA, hireDate: '2020-03-02' },
    ],
  };
  const expected = [
    [OMAR, 'changed', null],
    [PIA, 'changed', null],
    [RUI, 'refused', 'HIRE_INCOMPLETE'],
    [ANA, 'refused', 'INVALID_TRANSITION'],
  ];

  it('previews who is hired and who is skipped and why, keeping nothing', async () => {
    const seen = await post('/v1/views/bulk-hire/preview', batch, null);
    expect(seen.status).toBe(200);
    expect(seen.body['committed']).toBe(false);
    expect(outcomes(seen.body['rows'] as Row[])).toEqual(expected);
    expect(await events(OMAR)).toEqual([]);
  });

  it('hires each person on their own, reporting the partial success', async () => {
    const done = await post('/v1/views/bulk-hire', batch, 'bulk-hire-1');
    expect(done.status).toBe(200);
    expect(done.body['committed']).toBe(true);
    const rows = done.body['rows'] as (Row & { changes: { key: string; after: unknown }[] })[];
    expect(outcomes(rows)).toEqual(expected);
    expect(rows[0]?.changes.find((c) => c.key === 'status')?.after).toBe('Active');
    expect(rows[1]?.changes.find((c) => c.key === 'status')?.after).toBe('Starting soon');
    expect(await events(OMAR)).toContainEqual(['people.person.hired', '2020-03-02']);
    expect(await events(PIA)).toContainEqual(['people.person.hired', '2099-01-04']);
    expect(await events(RUI)).toEqual([]);
    // Lena from the profile, Omar here: three active; Pia pre-hire and Rui still not started.
    expect(await counts()).toEqual([5, 3, 2]);
  });

  it('is HR’s', async () => {
    const refused = await post('/v1/views/bulk-hire/preview', batch, null, headers(OTHER_ACCOUNT));
    expect(refused.status).toBe(403);
  });
});
