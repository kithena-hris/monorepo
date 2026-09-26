import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { createYoga } from 'graphql-yoga';
import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { startObjectStore, startPostgres } from '@kithena/testing';

import { define, versionOf } from '../application/person/in-memory.js';
import { Person } from '../domain/person/person.js';
import { yogaOptions } from '../graphql/schema.js';
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
let stopObjects: (() => Promise<void>) | undefined;
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
  const [pg, objects] = await Promise.all([startPostgres(), startObjectStore()]);
  stopPg = pg.stop;
  stopObjects = objects.stop;
  // The bucket an import is uploaded to, straight from the browser (§14.2).
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
  const adminClient = postgres(pg.url, { max: 1 });
  clients.push(adminClient);
  const admin = drizzle(adminClient);
  for (const file of [
    '20260821120000_tenant_registry.sql',
    '20260922140000_people_bootstrap.sql',
    '20260922160000_people_registry.sql',
    '20260922170000_people_person.sql',
    '20260924220000_people_access_end.sql',
    '20260926143000_people_duplicates.sql',
    '20260924220200_people_employment_period.sql',
    '20260923110000_people_completeness.sql',
    '20260923120000_people_webhooks.sql',
    '20260924170000_people_calendar.sql',
    '20260924170100_people_tenant_company.sql',
    '20260924270100_people_entitlements.sql',
    '20260924270200_people_role_grant.sql',
    '20260924330000_people_identifier_review.sql',
    '20260924360000_people_import_upload.sql',
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
          effectiveDated: true,
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

  const yoga = createYoga(yogaOptions);
  server = createServer((request, response) => {
    void yoga(request, response);
  });
  wirePeople(server);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});

afterAll(async () => {
  // Missing when `beforeAll` failed, which is then the only error worth reading.
  const listening = server as Server | undefined;
  if (listening) await new Promise((resolve) => listening.close(resolve));
  for (const c of clients) await c.end();
  await stopPg?.();
  await stopObjects?.();
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
        query: `mutation { revokeRole(accountId: "${MARCO_ACCOUNT}", role: finance, reason: "Moved team", idempotencyKey: "graph-1") { accountId roles } }`,
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

/*
 * The screens over GraphQL (PEO-113): what the tenant app reads and writes
 * through the router, against the same booted service.
 */
describe('the screens over GraphQL', () => {
  const graph = async (
    as: Record<string, string>,
    query: string,
    variables: Record<string, unknown> = {},
  ): Promise<{ data?: Record<string, unknown>; errors?: { extensions: { code: string } }[] }> => {
    const response = await fetch(`${base}/graphql`, {
      method: 'POST',
      headers: as,
      body: JSON.stringify({ query, variables }),
    });
    return (await response.json()) as never;
  };
  const PROFILE = `query ($id: ID) {
    peopleProfile(personId: $id) {
      person { name }
      sections { key fields { key } }
      values {
        __typename
        ... on TextEntry { key text }
        ... on MoneyEntry { key amountMinor currency }
        ... on EmptyEntry { key }
      }
    }
  }`;
  interface Profile {
    sections: { key: string; fields: { key: string }[] }[];
    values: { key: string }[];
  }

  it('leaves a field the viewer may not read out of the values and the sections — no key, no null', async () => {
    await fetch(`${base}/v1/people/${ADA}`, {
      method: 'PATCH',
      headers: { ...headers(HR_ACCOUNT, ['hr']), 'idempotency-key': 'screens-seed' },
      body: JSON.stringify({
        attributes: { base_salary: { amountMinor: 5_500_000, currency: 'EUR' } },
      }),
    });

    const manager = await graph(headers(MARCO_ACCOUNT), PROFILE, { id: ADA });
    expect(manager.errors).toBeUndefined();
    const seen = manager.data?.['peopleProfile'] as Profile;
    expect(seen.values.map((v) => v.key)).not.toContain('base_salary');
    expect(seen.sections.flatMap((s) => s.fields.map((f) => f.key))).not.toContain('base_salary');
    expect(JSON.stringify(manager.data)).not.toContain('base_salary');

    const hr = await graph(headers(HR_ACCOUNT, ['hr']), PROFILE, { id: ADA });
    expect(hr.errors).toBeUndefined();
    expect((hr.data?.['peopleProfile'] as Profile | undefined)?.values).toContainEqual({
      __typename: 'MoneyEntry',
      key: 'base_salary',
      amountMinor: '5500000',
      currency: 'EUR',
    });
  });

  it('writes a section with a key, and answers a retry of that key without writing again', async () => {
    const SAVE = `mutation ($id: ID!, $key: String!) {
      savePersonSection(personId: $id, changed: [{ key: "job_title", text: "Staff Engineer" }], idempotencyKey: $key) { ok }
    }`;
    const hr = headers(HR_ACCOUNT, ['hr']);
    expect((await graph(hr, SAVE, { id: ADA, key: 'section-1' })).data).toEqual({
      savePersonSection: { ok: true },
    });
    expect((await graph(hr, SAVE, { id: ADA, key: 'section-1' })).data).toEqual({
      savePersonSection: { ok: true },
    });
    const keys = await clients[0]?.unsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM people.idempotency_key WHERE key = 'section-1'`,
    );
    expect(keys?.[0]?.n).toBe(1);
    const profile = await graph(hr, PROFILE, { id: ADA });
    expect((profile.data?.['peopleProfile'] as Profile | undefined)?.values).toContainEqual({
      __typename: 'TextEntry',
      key: 'job_title',
      text: 'Staff Engineer',
    });

    const unkeyed = await graph(
      hr,
      `mutation { savePersonSection(personId: "${ADA}", changed: [{ key: "job_title", text: "x" }]) { ok } }`,
    );
    expect(unkeyed.errors).toBeDefined();
  });

  it('reads a record as of a date with every change behind it, corrections superseding (PEO-064)', async () => {
    const hr = headers(HR_ACCOUNT, ['hr']);
    const pay = (amountMinor: number, effectiveFrom: string, key: string) =>
      fetch(`${base}/v1/people/${ADA}`, {
        method: 'PATCH',
        headers: { ...hr, 'idempotency-key': key },
        body: JSON.stringify({
          attributes: { base_salary: { amountMinor, currency: 'EUR' } },
          effectiveFrom,
        }),
      });
    expect((await pay(5_000_000, '2026-03-01', 'history-march')).status).toBe(200);
    expect((await pay(6_000_000, '2026-06-01', 'history-june')).status).toBe(200);
    const rows = (await (
      await fetch(`${base}/v1/people/${ADA}/history?attribute=base_salary`, { headers: hr })
    ).json()) as { items: { id: string; effectiveFrom: string }[] };
    const march = rows.items.find((r) => r.effectiveFrom === '2026-03-01');
    const fixed = await fetch(`${base}/v1/people/${ADA}/corrections`, {
      method: 'POST',
      headers: { ...hr, 'idempotency-key': 'history-typo' },
      body: JSON.stringify({
        supersedes: march?.id,
        value: { amountMinor: 5_100_000, currency: 'EUR' },
        reason: 'typo',
      }),
    });
    expect(fixed.status).toBe(201);

    const HISTORY = `query ($id: ID, $asOf: String) {
      peopleHistory(personId: $id, asOf: $asOf) {
        person { id name }
        asOf dated
        sections { key fields { key } }
        values { __typename ... on MoneyEntry { key amountMinor } ... on TextEntry { key text } }
        changes {
          id key effectiveFrom recordedAt by supersedes supersededBy
          value { __typename ... on MoneyEntry { amountMinor } }
        }
      }
    }`;
    interface History {
      asOf: string | null;
      dated: string[];
      values: { key: string; amountMinor?: string }[];
      changes: {
        id: string;
        key: string;
        effectiveFrom: string;
        by: string;
        supersedes: string | null;
        supersededBy: string | null;
        value: { amountMinor?: string };
      }[];
    }
    const asHr = await graph(hr, HISTORY, { id: ADA, asOf: '2026-04-15' });
    expect(asHr.errors).toBeUndefined();
    const seen = asHr.data?.['peopleHistory'] as History;
    expect(seen.asOf).toBe('2026-04-15');
    expect(seen.dated).toEqual(['base_salary']);
    // March as corrected, not as typed: no pay cut followed by a raise.
    expect(seen.values).toContainEqual({
      __typename: 'MoneyEntry',
      key: 'base_salary',
      amountMinor: '5100000',
    });
    // A field kept without dates has no value "as of" a past day.
    expect(seen.values.map((v) => v.key)).not.toContain('job_title');
    const typo = seen.changes.find((c) => c.id === march?.id);
    const correction = seen.changes.find((c) => c.supersedes === march?.id);
    expect(typo?.supersededBy).toBe(correction?.id);
    expect(typo?.value.amountMinor).toBe('5000000');
    expect(correction).toMatchObject({
      effectiveFrom: '2026-03-01',
      by: 'You',
      value: { amountMinor: '5100000' },
    });

    // The manager reads job title and never salary — not now, not as of March, not in its history.
    const asManager = await graph(headers(MARCO_ACCOUNT), HISTORY, { id: ADA, asOf: '2026-04-15' });
    expect(asManager.errors).toBeUndefined();
    expect(JSON.stringify(asManager.data)).not.toContain('base_salary');
    expect(JSON.stringify(asManager.data)).not.toContain('5100000');
    expect((asManager.data?.['peopleHistory'] as History).changes.map((c) => c.key)).toContain(
      'job_title',
    );

    const bad = await graph(hr, HISTORY, { id: ADA, asOf: 'March' });
    expect(bad.errors?.[0]?.extensions.code).toBe('BAD_REQUEST');
  });

  it('takes an import through storage: the browser PUTs the file, GraphQL carries none', async () => {
    const graphAs = async (query: string, variables: Record<string, unknown>) =>
      (await (
        await fetch(`${base}/graphql`, {
          method: 'POST',
          headers: headers(HR_ACCOUNT, ['hr']),
          body: JSON.stringify({ query, variables }),
        })
      ).json()) as { data?: Record<string, unknown>; errors?: unknown };

    const file = new TextEncoder().encode('work_email,job_title\nnew@acme.example,Engineer\n');
    const started = await graphAs(
      `mutation ($name: String!, $size: Int!) {
        startImportUpload(name: $name, size: $size) { uploadId url method headers { name value } }
      }`,
      { name: 'people.csv', size: file.byteLength },
    );
    expect(started.errors).toBeUndefined();
    const target = started.data?.['startImportUpload'] as {
      uploadId: string;
      url: string;
      method: string;
      headers: { name: string; value: string }[];
    };
    const put = await fetch(target.url, {
      method: target.method,
      headers: Object.fromEntries(
        target.headers.filter((h) => h.name !== 'content-length').map((h) => [h.name, h.value]),
      ),
      body: file,
    });
    expect(put.status).toBe(200);

    const completed = await graphAs(
      `mutation ($id: ID!) { completeImportUpload(uploadId: $id) {
        __typename ... on ImportMapStage { step file { name rows } }
      } }`,
      { id: target.uploadId },
    );
    expect(completed.errors).toBeUndefined();
    expect(completed.data?.['completeImportUpload']).toMatchObject({
      __typename: 'ImportMapStage',
      step: 'map',
      file: { name: 'people.csv', rows: 1 },
    });
  });

  it('takes no multipart request at all: no file comes through GraphQL', async () => {
    const form = new FormData();
    form.set('operations', JSON.stringify({ query: '{ __typename }', variables: {} }));
    form.set('map', '{}');
    const hr = Object.fromEntries(
      Object.entries(headers(HR_ACCOUNT, ['hr'])).filter(([name]) => name !== 'content-type'),
    );
    const response = await fetch(`${base}/graphql`, { method: 'POST', headers: hr, body: form });
    expect(response.ok).toBe(false);
  });
});
