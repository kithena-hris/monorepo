import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
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
let pgUrl = '';
let stopObjects: (() => Promise<void>) | undefined;
const clients: ReturnType<typeof postgres>[] = [];
let server: Server;
let base = '';

const headers = (account: string, roles: string[] = [], tenantId = ACME) => ({
  'content-type': 'application/json',
  'x-internal-token': 'router-secret',
  'x-kithena-principal': JSON.stringify({
    userId: account,
    tenantId,
    roles,
    entitlements: ['module.people'],
  }),
});

const migration = (file: string): Promise<string> =>
  readFile(new URL(`../../../../migrations/${file}`, import.meta.url), 'utf8');

beforeAll(async () => {
  const [pg, objects] = await Promise.all([startPostgres(), startObjectStore()]);
  stopPg = pg.stop;
  pgUrl = pg.url;
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
  // Every migration, as a deployment has them: a company's first import runs
  // to the end here, through the ledger, numbering and activity tables.
  for (const role of ['svc_identity', 'svc_messaging', 'svc_slack']) {
    await adminClient.unsafe(`CREATE ROLE ${role} NOLOGIN NOBYPASSRLS`);
  }
  const all = new URL('../../../../migrations/', import.meta.url);
  for (const file of (await readdir(all)).filter((f) => f.endsWith('.sql')).toSorted()) {
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
  const seed = (
    id: string,
    account: string | null,
    managerId: string | null,
    employmentType: string | null = null,
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
        { managerId, employmentType },
      ),
    );
  await seed(MARCO, MARCO_ACCOUNT, null);
  await seed(ADA, null, MARCO, 'contractor');
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
        // PEO-077: switched on by the tenant, so a change waits for a second HR member.
        define({
          key: 'bonus',
          dataType: 'money',
          typeConfig: { kind: 'money' },
          visibility: ['hr'],
          effectiveDated: true,
          requiresApproval: true,
          classification: {
            classification: 'confidential',
            piiKind: 'none',
            exportable: true,
            aiEligible: false,
          },
        }),
        // PEO-066: a manager reads a contractor's end date, and a note that
        // only an intern's manager would.
        ...(['contract_end', 'intern_note'] as const).map((key) =>
          define({
            key,
            visibility: ['hr'],
            visibilityRules: [
              {
                scopes: ['manager'],
                when: {
                  combine: 'all',
                  clauses: [
                    {
                      operand: 'employmentType',
                      in: [key === 'contract_end' ? 'contractor' : 'intern'],
                    },
                  ],
                },
              },
            ],
          }),
        ),
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

  it('holds a change that requires approval until a second HR member approves it (PEO-077)', async () => {
    const SECOND_HR = '00000000-0000-4000-8000-0000000000b4';
    const bonus = { amountMinor: 250_000, currency: 'EUR' };
    const patched = await fetch(`${base}/v1/people/${ADA}`, {
      method: 'PATCH',
      headers: { ...headers(HR_ACCOUNT, ['hr']), 'idempotency-key': 'bonus' },
      body: JSON.stringify({ attributes: { bonus }, effectiveFrom: '2026-09-01' }),
    });
    expect(patched.status).toBe(200);
    const written = (await patched.json()) as {
      attributes: Record<string, unknown>;
      pendingChanges: { id: string; attributeKey: string; value: unknown; mine: boolean }[];
    };
    expect(written.attributes).not.toHaveProperty('bonus');
    expect(written.pendingChanges).toEqual([
      expect.objectContaining({
        attributeKey: 'bonus',
        value: bonus,
        mine: true,
        canDecide: false,
      }),
    ]);
    const changeId = written.pendingChanges[0]?.id ?? '';

    const inbox = await fetch(`${base}/v1/pending-changes`, {
      headers: headers(SECOND_HR, ['hr']),
    });
    expect(((await inbox.json()) as { items: { id: string; canDecide: boolean }[] }).items).toEqual(
      [expect.objectContaining({ id: changeId, canDecide: true })],
    );

    // With a note: back-dated pay may be flagged, and approving a flag needs one.
    const decide = (account: string, key: string) =>
      fetch(`${base}/v1/pending-changes/${changeId}/decision`, {
        method: 'POST',
        headers: { ...headers(account, ['hr']), 'idempotency-key': key },
        body: JSON.stringify({ approve: true, note: 'September’s bonus, agreed in August' }),
      });
    expect((await decide(HR_ACCOUNT, 'own')).status).toBe(403);
    const approved = await decide(SECOND_HR, 'second');
    expect(approved.status).toBe(200);
    expect(await approved.json()).toMatchObject({ id: changeId, state: 'approved' });

    const read = await fetch(`${base}/v1/people/${ADA}`, { headers: headers(HR_ACCOUNT, ['hr']) });
    expect(
      ((await read.json()) as { attributes: Record<string, unknown> }).attributes,
    ).toMatchObject({ bonus });
    const history = await fetch(`${base}/v1/people/${ADA}/history?attribute=bonus`, {
      headers: headers(HR_ACCOUNT, ['hr']),
    });
    expect(
      ((await history.json()) as { items: { effectiveFrom: string }[] }).items.map(
        (e) => e.effectiveFrom,
      ),
    ).toEqual(['2026-09-01']);
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

  it('shows a field by a custom rule on the records it holds for, over REST and GraphQL (PEO-066)', async () => {
    const written = await fetch(`${base}/v1/people/${ADA}`, {
      method: 'PATCH',
      headers: { ...headers(HR_ACCOUNT, ['hr']), 'idempotency-key': 'rules-seed' },
      body: JSON.stringify({ attributes: { contract_end: '2027-03-31', intern_note: 'n/a' } }),
    });
    expect(written.status).toBe(200);

    const manager = await graph(headers(MARCO_ACCOUNT), PROFILE, { id: ADA });
    expect(manager.errors).toBeUndefined();
    const keys = (manager.data?.['peopleProfile'] as Profile | undefined)?.values.map((v) => v.key);
    expect(keys).toContain('contract_end');
    expect(keys).not.toContain('intern_note');

    const rest = await fetch(`${base}/v1/people/${ADA}`, { headers: headers(MARCO_ACCOUNT) });
    const body = (await rest.json()) as { attributes: Record<string, unknown> };
    expect(body.attributes['contract_end']).toBe('2027-03-31');
    expect(Object.hasOwn(body.attributes, 'intern_note')).toBe(false);

    // A filter answers for everybody, so no rule makes a field filterable.
    const filtered = await fetch(`${base}/v1/people?filter=contract_end:2027-03-31`, {
      headers: headers(MARCO_ACCOUNT),
    });
    expect(filtered.status).toBe(403);
  });

  it('saves a predicate and a custom rule through GraphQL, and refuses a rule that discloses (PEO-065, PEO-066)', async () => {
    const admin = headers(HR_ACCOUNT, ['people_admin']);
    const section = await graph(
      admin,
      `mutation { addDraftSection(label: "Contracts", idempotencyKey: "rules-section") { ok } }`,
    );
    expect(section.errors).toBeUndefined();
    const SAVE = `mutation ($input: DraftFieldInput!, $key: String!) {
      saveDraftField(input: $input, idempotencyKey: $key) { ok }
    }`;
    const when = {
      combine: 'all',
      clauses: [{ operand: 'employmentType', in: ['contractor'] }],
    };
    const input = (key: string, over: Record<string, unknown> = {}) => ({
      key,
      sectionKey: 'contracts',
      label: key,
      dataType: 'text',
      options: [],
      requiredness: 'never',
      ownership: ['hr'],
      collectAt: 'hr_only',
      visibility: ['hr'],
      classification: 'internal',
      piiKind: 'none',
      classificationSource: 'human',
      ...over,
    });
    // A rule on a placement fact needs its field readable by the scope it
    // grants: managers see employment type here, so "for contractors" is theirs.
    expect(
      (
        await graph(admin, SAVE, {
          key: 'rules-0',
          input: input('employment_type', { visibility: ['manager', 'hr'] }),
        })
      ).errors,
    ).toBeUndefined();
    expect(
      (
        await graph(admin, SAVE, {
          key: 'rules-1',
          input: input('agency', {
            requiredness: 'conditional',
            requiredWhen: when,
            visibilityRules: [{ scopes: ['manager'], when }],
          }),
        })
      ).errors,
    ).toBeUndefined();

    const REGISTRY = `{ peopleRegistry {
      fields { key requiredness requiredWhen { combine clauses { operand in } }
               visibilityRules { scopes when { clauses { operand in } } } }
      choices { countries { value } }
    } }`;
    const registry = await graph(admin, REGISTRY);
    const registered = registry.data?.['peopleRegistry'] as {
      fields: { key: string }[];
      choices: { countries: { value: string }[] };
    };
    expect(registered.fields.find((f) => f.key === 'agency')).toEqual({
      key: 'agency',
      requiredness: 'conditional',
      requiredWhen: {
        combine: 'all',
        clauses: [{ operand: 'employmentType', in: ['contractor'] }],
      },
      visibilityRules: [
        {
          scopes: ['manager'],
          when: { clauses: [{ operand: 'employmentType', in: ['contractor'] }] },
        },
      ],
    });
    expect(registered.choices.countries.map((c) => c.value)).toContain('ES');

    // "Managers see this when `agency` is Acme" would tell them every
    // contractor's agency: `agency` is HR's.
    const discloses = await graph(admin, SAVE, {
      key: 'rules-2',
      input: input('agency_notes', {
        visibilityRules: [
          {
            scopes: ['manager'],
            when: { combine: 'all', clauses: [{ operand: 'attribute', key: 'agency', is: 'set' }] },
          },
        ],
      }),
    });
    expect(discloses.errors?.[0]?.extensions.code).toBe('VISIBILITY_RULE_DISCLOSES');

    // "Managers see this for people on leave" tells them who is on leave:
    // status is HR's alone.
    const onLeave = await graph(admin, SAVE, {
      key: 'rules-3',
      input: input('leave_cover', {
        visibilityRules: [
          {
            scopes: ['manager'],
            when: { combine: 'all', clauses: [{ operand: 'status', in: ['on_leave'] }] },
          },
        ],
      }),
    });
    expect(onLeave.errors?.[0]?.extensions.code).toBe('VISIBILITY_RULE_DISCLOSES');
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
    // `bonus` is dated too (PEO-077's field); what matters here is the salary.
    expect(seen.dated).toEqual(['base_salary', 'bonus']);
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
    expect(
      (asManager.data?.['peopleHistory'] as History | undefined)?.changes.map((c) => c.key),
    ).toContain('job_title');

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

describe('a company that has never published its employee fields', () => {
  // A tenant of its own: nothing published, nothing in the draft, nobody here.
  const FRESH = '00000000-0000-4000-8000-00000000000f';
  const OWNER = '00000000-0000-4000-8000-0000000000f1';
  type Graph = {
    data?: Record<string, unknown>;
    errors?: { message: string; extensions: { code: string } }[];
  };
  const graph = async (query: string, variables: Record<string, unknown> = {}) =>
    (await (
      await fetch(`${base}/graphql`, {
        method: 'POST',
        headers: headers(OWNER, ['people_admin', 'hr'], FRESH),
        body: JSON.stringify({ query, variables }),
      })
    ).json()) as Graph;
  const file = new TextEncoder().encode(
    'given_name,family_name,work_email,hire_date,T-shirt size\n' +
      'Ana,López,ana@fresh.example,2026-10-01,S\n' +
      'Bo,Chen,bo@fresh.example,2026-10-01,M\n',
  );
  const upload = async () => {
    const started = await graph(
      `mutation ($name: String!, $size: Int!) {
        startImportUpload(name: $name, size: $size) { uploadId url method headers { name value } }
      }`,
      { name: 'first.csv', size: file.byteLength },
    );
    const target = started.data?.['startImportUpload'] as {
      uploadId: string;
      url: string;
      method: string;
      headers: { name: string; value: string }[];
    };
    await fetch(target.url, {
      method: target.method,
      headers: Object.fromEntries(
        target.headers.filter((h) => h.name !== 'content-length').map((h) => [h.name, h.value]),
      ),
      body: file,
    });
    const completed = await graph(
      `mutation ($id: ID!) { completeImportUpload(uploadId: $id) {
        __typename ... on ImportMapStage { step columns { index header status key } fields { key } }
      } }`,
      { id: target.uploadId },
    );
    return { uploadId: target.uploadId, completed };
  };

  it('imports without a detour: the plan sets the company up, adds the file’s new field and imports, on one approval', async () => {
    // The company as the back office makes it: one legal entity, in Spain.
    const entity = await graph(
      `mutation ($key: String!) {
        confirmSetupEntity(name: "Fresh SL", country: "ES", idempotencyKey: $key) { __typename }
      }`,
      { key: 'fresh-entity' },
    );
    expect(entity.errors?.[0]?.message).toBeUndefined();

    // Read against what setup would publish: the core fields map, the T-shirt size matches nothing.
    const { uploadId, completed } = await upload();
    expect(completed.errors).toBeUndefined();
    const stage = completed.data?.['completeImportUpload'] as {
      columns: { index: number; header: string; status: string; key: string | null }[];
    };
    expect(stage.columns.find((c) => c.header === 'work_email')?.status).toBe('mapped');
    expect(stage.columns.find((c) => c.header === 'T-shirt size')).toMatchObject({
      status: 'ignored',
      key: null,
    });
    // Nothing was written by reading it: still nothing published.
    const template = await graph('{ peopleImportTemplate }');
    expect(template.errors?.[0]?.message).toBeUndefined();

    // Proposals: setup comes with them, as version 1.
    const step = { uploadId, mapping: {} };
    const proposed = await graph(`mutation ($step: String!) { proposeImportFields(step: $step) }`, {
      step: JSON.stringify(step),
    });
    expect(proposed.errors?.[0]?.message).toBeUndefined();
    const view = JSON.parse(proposed.data?.['proposeImportFields'] as string) as {
      blocked: string | null;
      canCreate: boolean;
      version: number;
      setup: unknown;
      proposals: {
        column: number;
        key: string;
        include: boolean;
        counts: unknown;
        sensitive: unknown;
      }[];
    };
    expect(view).toMatchObject({ blocked: null, canCreate: true, version: 1 });
    expect(view.setup).toEqual({ country: 'ES', countryName: 'Spain' });
    expect(view.proposals.map((p) => p.column)).toEqual([4]);
    // The proposals as the screen sends them back: without the counts it was shown.
    const proposals = view.proposals.map(({ counts: _c, sensitive: _s, ...p }) => p);

    // The plan: setup, the field, the two people. Nothing written.
    const planned = await graph(`mutation ($input: String!) { planImport(input: $input) }`, {
      input: JSON.stringify({ ...step, proposals }),
    });
    expect(planned.errors?.[0]?.message).toBeUndefined();
    const plan = JSON.parse(planned.data?.['planImport'] as string) as {
      steps: { kind: string; title: string }[];
      review: {
        dryRun: { counts: { create: number; blocked: number }; blocked: { problem: string }[] };
      };
    };
    expect(plan.steps.map((x) => x.kind)).toEqual(['setup', 'fields', 'people']);
    expect(plan.review.dryRun.counts).toMatchObject({ create: 2, blocked: 0 });

    // Approve and run.
    const done = await runToEnd<{ created: number; version: number; fields: { label: string }[] }>(
      graph,
      { ...step, proposals },
      'fresh-run',
    );
    expect(done).toMatchObject({ created: 2, version: 1 });
    expect(done.fields.map((f) => f.label)).toEqual(['T-shirt size']);

    // Version 1 holds setup's fields and the new one; the template now names it.
    const after = await graph('{ peopleImportTemplate }');
    expect(String(after.data?.['peopleImportTemplate'])).toContain('T-shirt size');
  });
});

interface Answered {
  data?: Record<string, unknown>;
  errors?: { message: string; extensions: { code: string } }[];
}

/** Approve and run: the import's outcome, or the test fails on its error. */
async function runToEnd<T>(
  graph: (query: string, variables?: Record<string, unknown>) => Promise<Answered>,
  input: unknown,
  key: string,
): Promise<T> {
  const ran = await graph(
    `mutation ($input: String!, $key: String!) { runImport(input: $input, idempotencyKey: $key) }`,
    { input: JSON.stringify(input), key },
  );
  expect(ran.errors?.[0]?.message).toBeUndefined();
  return JSON.parse(ran.data?.['runImport'] as string) as T;
}

const company = (tenant: string, owner: string) => {
  const graph = async (query: string, variables: Record<string, unknown> = {}) =>
    (await (
      await fetch(`${base}/graphql`, {
        method: 'POST',
        headers: headers(owner, ['people_admin', 'hr'], tenant),
        body: JSON.stringify({ query, variables }),
      })
    ).json()) as Answered;
  const upload = async (file: Uint8Array<ArrayBuffer>) => {
    const started = await graph(
      `mutation ($name: String!, $size: Int!) {
        startImportUpload(name: $name, size: $size) { uploadId url method headers { name value } }
      }`,
      { name: 'people-2026-10-01.csv', size: file.byteLength },
    );
    const target = started.data?.['startImportUpload'] as {
      uploadId: string;
      url: string;
      method: string;
      headers: { name: string; value: string }[];
    };
    await fetch(target.url, {
      method: target.method,
      headers: Object.fromEntries(
        target.headers.filter((h) => h.name !== 'content-length').map((h) => [h.name, h.value]),
      ),
      body: file,
    });
    const completed = await graph(
      `mutation ($id: ID!) { completeImportUpload(uploadId: $id) {
        __typename ... on ImportMapStage { columns { index header status key reason } }
      } }`,
      { id: target.uploadId },
    );
    expect(completed.errors?.[0]?.message).toBeUndefined();
    const stage = completed.data?.['completeImportUpload'] as {
      columns: {
        index: number;
        header: string;
        status: string;
        key: string | null;
        reason: string | null;
      }[];
    };
    return { uploadId: target.uploadId, columns: stage.columns };
  };
  return { graph, upload };
};

/** As the back office leaves a company: one legal entity, in the US, nothing published. */
const fresh = async (tenant: string, owner: string) => {
  const c = company(tenant, owner);
  const entity = await c.graph(
    `mutation ($key: String!) {
      confirmSetupEntity(name: "Dunder Mifflin Paper Company", country: "US", idempotencyKey: $key) {
        __typename
      }
    }`,
    { key: `${tenant}-entity` },
  );
  expect(entity.errors?.[0]?.message).toBeUndefined();
  return c;
};

describe('a dev export from another Kithena, into a company the back office just made', () => {
  // The user's file, as their own Kithena exported it: its person ids, its
  // managers as those ids, its legal entity and work locations as ids of a
  // company that is not this one. One row, a provisional record there, has
  // no start date.
  const DEV = readFile(new URL('./dev-export.fixture.csv', import.meta.url));
  const LOCATIONS: Record<string, string> = {
    '01a0e1d1-f26f-7000-be34-a7236a53ad47': 'Corporate, New York',
    '01a0e1d1-f2cf-7000-b695-91d31c4467ed': 'Scranton Branch',
    '01a0e1d1-f2de-7000-9faf-893e9d24b64a': 'Nashua Branch',
    '01a0e1d1-f2ec-7000-bc85-bd7e038b7395': 'Utica Branch',
  };

  /** Upload, keep every proposed field, plan, and run it to the end. */
  const importAll = async (
    c: ReturnType<typeof company>,
    file: Uint8Array<ArrayBuffer>,
    key: string,
  ) => {
    const { uploadId, columns } = await c.upload(file);
    // As the screen sends it: every column, its key when mapped, else null.
    const mapping = Object.fromEntries(
      columns.map((x) => [x.index, x.status === 'mapped' ? x.key : null]),
    );
    const step = { uploadId, mapping };
    const proposed = await c.graph(
      `mutation ($step: String!) { proposeImportFields(step: $step) }`,
      { step: JSON.stringify(step) },
    );
    expect(proposed.errors?.[0]?.message).toBeUndefined();
    const view = JSON.parse(proposed.data?.['proposeImportFields'] as string) as {
      proposals: { counts: unknown; sensitive: unknown }[];
    };
    const proposals = view.proposals.map(({ counts: _c, sensitive: _s, ...p }) => p);
    const planned = await c.graph(`mutation ($input: String!) { planImport(input: $input) }`, {
      input: JSON.stringify({ ...step, proposals }),
    });
    expect(planned.errors?.[0]?.message).toBeUndefined();
    const plan = JSON.parse(planned.data?.['planImport'] as string) as {
      blocked: string | null;
      steps: { kind: string; title: string }[];
      review: {
        dryRun: {
          counts: Record<string, number>;
          blocked: { row: number; problem: string }[];
          leftEmpty: { cell: string; label: string; reason: string }[];
          leftEmptyCount: number;
        };
      };
    };
    expect(plan.blocked).toBeNull();
    const done = await runToEnd<{
      created: number;
      updated: number;
      blocked: number;
      leftEmptyCount: number;
    }>(c.graph, { ...step, proposals }, key);
    return { columns, plan, done };
  };

  /** Read as the database's owner, past row-level security: what was really written. */
  const written = async <T>(tenant: string, query: string): Promise<T[]> => {
    const client = postgres(pgUrl, { max: 1 });
    try {
      return (await client.unsafe(query, [tenant])) as unknown as T[];
    } finally {
      await client.end();
    }
  };
  interface Written {
    id: string;
    email: string;
    num: string | null;
    manager: string | null;
    location: string | null;
    location_id: string | null;
    entity: string | null;
  }
  // Dated facts as recorded, whenever they take effect: one row starts next month.
  const latest = (key: string) => `(SELECT h.value #>> '{}' FROM people.person_attribute_history h
      WHERE h.tenant_id = p.tenant_id AND h.person_id = p.id AND h.attribute_key = '${key}'
      ORDER BY h.effective_from DESC, h.recorded_at DESC LIMIT 1)`;
  const PEOPLE = `SELECT p.id::text AS id, p.work_email AS email, p.employee_number AS num,
        (SELECT m.work_email FROM people.person m
          WHERE m.tenant_id = p.tenant_id AND m.id::text = ${latest('manager_id')}) AS manager,
        (SELECT l.name FROM people.location l
          WHERE l.tenant_id = p.tenant_id AND l.id::text = ${latest('location_id')}) AS location,
        ${latest('location_id')} AS location_id,
        ${latest('legal_entity_id')} AS entity
      FROM people.person p
     WHERE p.tenant_id = $1::uuid`;

  it('creates everybody, links each manager within the file, numbers them, and writes no id from elsewhere', async () => {
    const TENANT = '00000000-0000-4000-8000-0000000000d0';
    const c = await fresh(TENANT, '00000000-0000-4000-8000-0000000000d9');
    const file = new Uint8Array(await DEV);
    const { columns, plan, done } = await importAll(c, file, 'dev-export-run');

    // The ids are Kithena's to create: shown, named, never imported.
    for (const header of ['Person id', 'Employee number']) {
      expect(columns.find((x) => x.header === header)).toMatchObject({
        status: 'ignored',
        reason: 'Kithena creates this',
      });
    }

    // The plan says so in one line, and nothing blocks a row: Gabe, with no
    // start date, comes in provisional, his start date listed for HR.
    expect(plan.steps.map((x) => x.title)).toContain(
      'Employee IDs in the file are ignored; Kithena gives each new person one',
    );
    expect(plan.review.dryRun.counts).toMatchObject({ create: 31, blocked: 0, duplicate: 0 });
    expect(plan.review.dryRun.blocked).toEqual([]);
    // Their work locations are ids with no name to find or add, and Gabe's
    // start date: left empty, each listed (the first twenty shown).
    expect(plan.review.dryRun.leftEmptyCount).toBe(31);
    expect(done).toMatchObject({ created: 31, updated: 0, blocked: 0, leftEmptyCount: 31 });

    const people = await written<Written>(TENANT, PEOPLE);
    expect(people).toHaveLength(31);
    // Nothing of the other company's: no id of theirs as a person, an entity or a place.
    const theirs = new Set(
      new TextDecoder()
        .decode(file)
        .split(/[\n,]/u)
        .filter((cell) => /^[0-9a-f]{8}-[0-9a-f]{4}-/u.test(cell)),
    );
    for (const p of people) {
      expect(theirs.has(p.id)).toBe(false);
      expect(p.location_id).toBeNull();
      expect(p.entity).not.toBeNull();
      expect(theirs.has(p.entity ?? '')).toBe(false);
    }
    // Every person hired is numbered by the entity's scheme, once each; Gabe
    // is numbered when HR hires him.
    const numbers = people.map((p) => p.num).filter((n) => n !== null);
    expect(numbers.every((n) => /^US-\d{5}$/u.test(n))).toBe(true);
    expect(new Set(numbers).size).toBe(30);

    // Each manager is the person their row became, whatever the file's order.
    const managerOf = Object.fromEntries(people.map((p) => [p.email, p.manager]));
    expect(managerOf['jan.levinson@dunder-mifflin.example']).toBe(
      'david.wallace@dunder-mifflin.example',
    );
    expect(managerOf['david.wallace@dunder-mifflin.example']).toBeNull();
    // Every one of the 29 rows that names a manager is linked.
    expect(people.filter((p) => p.manager !== null)).toHaveLength(29);

    // Each column lands in its own field: a child's name is the name, as written.
    const [jan] = await written<{ children: string | null; partner: string | null }>(
      TENANT,
      `SELECT custom->>'children' AS children, custom->>'partner' AS partner FROM people.person
        WHERE tenant_id = $1::uuid AND work_email = 'jan.levinson@dunder-mifflin.example'`,
    );
    expect(jan).toEqual({ children: 'Astrid', partner: null });
  });

  it('adds the work locations an export now names, and every person is placed in one', async () => {
    const TENANT = '00000000-0000-4000-8000-0000000000e0';
    const c = await fresh(TENANT, '00000000-0000-4000-8000-0000000000e9');
    // The same file as an export writes it now: a legal entity and a work location by name.
    let text = new TextDecoder().decode(new Uint8Array(await DEV));
    for (const [id, name] of Object.entries(LOCATIONS)) text = text.replaceAll(id, `"${name}"`);
    text = text.replaceAll('01a0e1d1-ef70-70ad-8cf7-9550c67358d3', 'Dunder Mifflin');
    const { plan, done } = await importAll(c, new TextEncoder().encode(text), 'named-run');

    expect(plan.steps.find((x) => x.kind === 'places')?.title).toBe(
      'Add 4 work locations: Corporate, New York, Scranton Branch, Nashua Branch and Utica Branch',
    );
    // Only Gabe's start date is left for HR.
    expect(done).toMatchObject({ created: 31, leftEmptyCount: 1 });
    const added = await written<{ name: string }>(
      TENANT,
      `SELECT name FROM people.location WHERE tenant_id = $1::uuid ORDER BY name`,
    );
    expect(added.map((l) => l.name)).toEqual([
      'Corporate, New York',
      'Nashua Branch',
      'Scranton Branch',
      'Utica Branch',
    ]);
    const people = await written<Written>(TENANT, PEOPLE);
    const at = Object.fromEntries(people.map((p) => [p.email, p.location]));
    expect(at['jan.levinson@dunder-mifflin.example']).toBe('Corporate, New York');
    expect(at['michael.scott@dunder-mifflin.example']).toBe('Scranton Branch');
    // Every row that names one: all but Bob's, which names none.
    expect(people.filter((p) => p.location !== null)).toHaveLength(30);
  });
});

describe('a realistic 105-column HR export, into a company with nothing published', () => {
  // The user's file (`.claude/data/make_employees.py`, seeded): every tenth
  // of its 1,000 rows, all 105 columns, every country and currency in it.
  // Nobody in the sample is serving notice, so two of its active people are,
  // here: a resignation with a last day two months ahead.
  const AHEAD = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10);
  const MERIDIAN = readFile(new URL('./meridian-freight.fixture.csv', import.meta.url), 'utf8').then(
    (csv) =>
      new TextEncoder().encode(
        csv.replaceAll(
          /^(MF000(?:11|21),.*?),Active,,,,,,,/gmu,
          `$1,Notice period,,,,${AHEAD},Resignation - new opportunity,Yes,`,
        ),
      ),
  );
  const TENANT = '00000000-0000-4000-8000-0000000000c0';
  const OWNER = '00000000-0000-4000-8000-0000000000c9';

  interface Proposal {
    column: number;
    header: string;
    key: string;
    include: boolean;
    why: string;
    field: {
      dataType: string;
      classification: string;
      piiKind: string;
      encrypted: boolean;
      requiresApproval?: boolean;
      visibility: string[];
      aiEligible: boolean;
    };
  }

  it('plans and runs on one approval, every column accounted for, every field one the settings take', async () => {
    const c = await fresh(TENANT, OWNER);
    const file = new Uint8Array(await MERIDIAN);
    const { uploadId, columns } = await c.upload(file);
    expect(columns).toHaveLength(105);
    const mapping = Object.fromEntries(
      columns.map((x) => [x.index, x.status === 'mapped' ? x.key : null]),
    );
    const step = { uploadId, mapping };

    const proposed = await c.graph(
      `mutation ($step: String!) { proposeImportFields(step: $step) }`,
      { step: JSON.stringify(step) },
    );
    expect(proposed.errors).toBeUndefined();
    const view = JSON.parse(proposed.data?.['proposeImportFields'] as string) as {
      blocked: string | null;
      proposals: (Proposal & { counts: unknown; sensitive: unknown })[];
      choices: { column: number; header: string; key: string; added: string[] }[];
    };
    // Employment type and work model are People's own: mapped onto them, never a second field.
    expect(view.choices.map((c) => [c.header, c.key, c.added])).toEqual([
      ['Employment Type', 'employment_type', ['Full-time', 'Part-time']],
      ['Work Arrangement', 'work_model', []],
    ]);
    expect(view.blocked).toBeNull();
    const proposals = view.proposals.map(({ counts: _c, sensitive: _s, ...p }) => p);
    const of = (header: string): Proposal => {
      const p = proposals.find((x) => x.header === header);
      if (p === undefined) throw new Error(`no proposal for ${header}`);
      return p;
    };

    // Every column: a field here, a new field, or an id Kithena creates.
    const proposedFor = new Set(proposals.map((p) => p.column));
    const ours = new Set(view.choices.map((c) => c.column));
    const where = (x: (typeof columns)[number]) =>
      x.status === 'mapped' || ours.has(x.index)
        ? 'existing'
        : x.reason === 'Kithena creates this'
          ? 'kithena'
          : proposedFor.has(x.index)
            ? 'new'
            : `${x.status}: ${x.reason ?? ''}`;
    expect(
      columns
        .filter((x) => !['existing', 'kithena', 'new'].includes(where(x)))
        .map((x) => [x.header, where(x)]),
    ).toEqual([]);
    // Nothing held back: special category is imported too.
    expect(proposals.filter((p) => !p.include).map((p) => p.header)).toEqual([]);
    // Nothing the settings would refuse: no sealed list, nothing fixed after the fact.
    const sealable = new Set([
      'text',
      'long_text',
      'email',
      'phone',
      'url',
      'number',
      'decimal',
      'date',
      'money',
    ]);
    for (const p of proposals) {
      if (p.field.encrypted)
        expect([p.header, sealable.has(p.field.dataType)]).toEqual([p.header, true]);
      expect([p.header, p.why]).not.toEqual([
        p.header,
        expect.stringMatching(/Kept as confidential text/u),
      ]);
    }

    // The columns that refused in production, now:
    expect(of('Work Authorization').field).toMatchObject({
      dataType: 'select',
      encrypted: false,
      classification: 'confidential',
      requiresApproval: true,
    });
    expect(of('Driver License Class').field).toMatchObject({
      dataType: 'select',
      encrypted: false,
      requiresApproval: true,
    });
    expect(of('Currency').field).toMatchObject({ dataType: 'currency', encrypted: false });
    expect(of('Bonus Target %').field).toMatchObject({ dataType: 'percentage', encrypted: false });
    expect(of('Last Raise %').field).toMatchObject({ dataType: 'percentage', encrypted: false });
    expect(of('Commission Plan').field).toMatchObject({ encrypted: false, requiresApproval: true });
    expect(of('Tax Filing Status').field).toMatchObject({
      dataType: 'select',
      encrypted: false,
      piiKind: 'none',
      requiresApproval: true,
    });
    expect(of('Annual Base Salary').field.dataType).toBe('money');
    for (const h of [
      'FTE',
      'Standard Weekly Hours',
      'Annual Leave Balance (days)',
      'Sick Leave Balance (days)',
    ]) {
      expect([h, of(h).field.dataType]).toEqual([h, 'decimal']);
    }
    for (const h of ['Passport Expiry', 'Last Raise Date', 'Leave Start Date', 'Date of Birth']) {
      expect([h, of(h).field.dataType]).toEqual([h, 'date']);
    }
    // Pay: confidential, HR and finance, changes approved.
    for (const h of [
      'Annual Base Salary',
      'Hourly Rate',
      'Bonus Target %',
      'Commission Plan',
      'Equity Grant (Units)',
      'Last Raise %',
    ]) {
      expect([h, of(h).field]).toEqual([
        h,
        expect.objectContaining({
          classification: 'confidential',
          visibility: ['hr', 'finance'],
          requiresApproval: true,
          aiEligible: false,
        }),
      ]);
    }
    // Identifiers: sealed text, never shown to the assistant.
    for (const h of [
      'National ID (SSN/NI/SIN/PAN)',
      'Tax ID / Steuer-ID',
      'Passport Number',
      'Driver License Number',
      'Work Permit Number',
      'IBAN',
      'Bank Account Number',
      'Routing / Sort / IFSC Code',
    ]) {
      expect([h, of(h).field]).toEqual([
        h,
        expect.objectContaining({ dataType: 'text', encrypted: true, aiEligible: false }),
      ]);
    }
    // Special category: imported, HR's alone, sealed where the type allows, approved.
    for (const h of [
      'Ethnicity',
      'Religion',
      'Disability Status',
      'Veteran Status',
      'Dietary Requirements',
      'Union Member',
    ]) {
      expect([h, of(h).include]).toEqual([h, true]);
      expect([h, of(h).field]).toEqual([
        h,
        expect.objectContaining({
          classification: 'special-category',
          visibility: ['hr'],
          aiEligible: false,
          requiresApproval: true,
        }),
      ]);
    }
    // Personal contact and address: the person's and HR's.
    for (const h of [
      'Personal Email',
      'Mobile Phone',
      'Home Address Line 1',
      'Home City',
      'Home Postal Code',
      'Emergency Contact Phone',
    ]) {
      expect([h, of(h).field]).toEqual([
        h,
        expect.objectContaining({ classification: 'confidential', visibility: ['self', 'hr'] }),
      ]);
    }
    // A postal code keeps its digits.
    expect(of('Home Postal Code').field.dataType).toBe('text');
    expect(proposals.filter((p) => /^(employment_type|work_model)/u.test(p.key))).toEqual([]);
    // The lifecycle is People's: the status and the termination columns are
    // mapped onto it, never fields. People keeps no leave record, so the leave
    // columns are fields; nothing else is.
    const lifecycleColumns = [
      'Employment Status',
      'Termination Date',
      'Termination Reason',
      'Eligible for Rehire',
    ];
    expect(
      columns.filter((x) => lifecycleColumns.includes(x.header)).map((x) => [x.header, x.status, x.key]),
    ).toEqual([
      ['Employment Status', 'mapped', 'employment_status'],
      ['Termination Date', 'mapped', 'last_working_day'],
      ['Termination Reason', 'mapped', 'leaving_reason'],
      ['Eligible for Rehire', 'mapped', 'eligible_for_rehire'],
    ]);
    expect(proposals.filter((p) => lifecycleColumns.includes(p.header))).toEqual([]);
    for (const h of ['Leave Type', 'Leave Start Date', 'Expected Return Date']) {
      expect([h, of(h).include]).toEqual([h, true]);
    }

    // The plan: nothing refused, nothing blocked, so Approve and run is on.
    const planned = await c.graph(`mutation ($input: String!) { planImport(input: $input) }`, {
      input: JSON.stringify({ ...step, proposals }),
    });
    expect(planned.errors).toBeUndefined();
    const plan = JSON.parse(planned.data?.['planImport'] as string) as {
      blocked: string | null;
      problems: unknown[];
      steps: { kind: string; title: string }[];
      review: {
        dryRun: {
          counts: Record<string, number>;
          workplaces: {
            value: string;
            note: string | null;
            proposed: { kind: string; country?: string; timeZone?: string; legalEntityId?: string };
          }[];
          lifecycle: { left: number; notice: number; onLeave: number; conflicts: object };
        };
      };
    };
    expect(plan.blocked).toBeNull();
    expect(plan.problems).toEqual([]);
    expect(plan.review.dryRun.counts).toMatchObject({ create: 100, blocked: 0, duplicate: 0 });
    // People's values under the file's spelling go to those; the rest are added.
    expect(plan.steps.map((s) => s.title)).toEqual(
      expect.arrayContaining([
        'Employment Type → Employment type; added Full-time and Part-time',
        'Work Arrangement → Work model',
        '5 people already left (offboarded from their termination date); 2 are serving notice (offboarding scheduled); 3 are on leave',
      ]),
    );
    expect(plan.review.dryRun.lifecycle).toEqual({ left: 5, notice: 2, onLeave: 3, conflicts: {} });
    // Each new office where the file says it is, in the company's one entity.
    const offices = Object.fromEntries(
      plan.review.dryRun.workplaces.map((w) => [
        w.value,
        [w.proposed.kind, w.proposed.country, w.proposed.timeZone, w.note],
      ]),
    );
    expect(offices).toMatchObject({
      'Chicago HQ': ['add', 'US', 'America/Chicago', null],
      'Atlanta Hub': ['add', 'US', 'America/New_York', null],
      'Dallas Distribution Center': ['add', 'US', 'America/Chicago', null],
      'Bengaluru Tech Center': ['add', 'IN', 'Asia/Kolkata', null],
      'Toronto Office': ['add', 'CA', 'America/Toronto', null],
      'London Office': ['add', 'GB', 'Europe/London', null],
      'Hamburg Port Office': ['add', 'DE', 'Europe/Berlin', null],
      'Madrid Office': ['add', 'ES', 'Europe/Madrid', null],
    });
    for (const w of plan.review.dryRun.workplaces) expect(w.proposed.legalEntityId).toBeDefined();

    // Approve and run, the offices as proposed.
    const done = await runToEnd<{
      created: number;
      blocked: number;
      held: number;
      columns: { existing: number; created: number; kithena: number; leftOut: number };
    }>(c.graph, { ...step, proposals }, 'meridian-run');
    expect(done).toMatchObject({ created: 100, blocked: 0, held: 0 });
    // 14 to People's own (employment type, work model and the four lifecycle
    // columns among them), 89 new, 2 ids.
    expect(done.columns).toEqual({ existing: 14, created: 89, kithena: 2, leftOut: 0 });

    // What was written: a salary as money in the row's currency, an identifier sealed.
    const client = postgres(pgUrl, { max: 1 });
    try {
      const [salary] = (await client.unsafe(
        `SELECT custom->'annual_base_salary' AS v, custom->>'currency' AS cur FROM people.person
          WHERE tenant_id = $1::uuid AND work_email = 'liz.okafor@meridianfreight.example'`,
        [TENANT],
      )) as unknown as { v: unknown; cur: string }[];
      expect(salary).toEqual({ v: { amountMinor: 46360000, currency: 'USD' }, cur: 'USD' });
      const [sealed] = (await client.unsafe(
        `SELECT count(*)::int AS n FROM people.person_secret WHERE tenant_id = $1::uuid AND attribute_key = 'passport_number'`,
        [TENANT],
      )) as unknown as { n: number }[];
      expect(sealed?.n).toBeGreaterThan(0);
      const [plain] = (await client.unsafe(
        `SELECT count(*)::int AS n FROM people.person WHERE tenant_id = $1::uuid AND custom ? 'passport_number'`,
        [TENANT],
      )) as unknown as { n: number }[];
      expect(plain?.n).toBe(0);
      // Every row in People's own fields, and no second field beside them. Read
      // from the dated history: a pre-hire's holds from their start date, so
      // the column is empty for them until then.
      const values = (await client.unsafe(
        `SELECT attribute_key AS k, value #>> '{}' AS v, count(*)::int AS n
           FROM people.person_attribute_history
          WHERE tenant_id = $1::uuid AND attribute_key IN ('employment_type', 'work_model')
          GROUP BY 1, 2`,
        [TENANT],
      )) as unknown as { k: string; v: string; n: number }[];
      const counted = (k: string) =>
        Object.fromEntries(values.filter((r) => r.k === k).map((r) => [r.v, r.n]));
      expect(counted('employment_type')).toEqual({
        full_time: 93,
        part_time: 3,
        fixed_term: 2,
        contractor: 2,
      });
      expect(counted('work_model')).toEqual({ hybrid: 44, onsite: 41, remote: 15 });
      // The columns take a company's own value: all but the three pre-hires, today.
      const [column] = (await client.unsafe(
        `SELECT count(employment_type)::int AS t, count(work_model)::int AS w,
                count(*) FILTER (WHERE employment_type = 'full_time')::int AS full
           FROM people.person WHERE tenant_id = $1::uuid`,
        [TENANT],
      )) as unknown as { t: number; w: number; full: number }[];
      expect(column?.t).toBeGreaterThanOrEqual(97);
      expect(column?.w).toBe(column?.t);
      expect(column?.full).toBeGreaterThanOrEqual(90);
      const [second] = (await client.unsafe(
        `SELECT count(*)::int AS n FROM people.person
          WHERE tenant_id = $1::uuid AND (custom ? 'employment_type_2' OR custom ? 'work_arrangement')`,
        [TENANT],
      )) as unknown as { n: number }[];
      expect(second?.n).toBe(0);

      // The leavers: offboarded from their termination date, with the reason
      // People counts and the file's words beside it, never given access.
      const leavers = (await client.unsafe(
        `SELECT p.work_email AS email, p.status, p.last_working_day::text AS day,
                p.identity_account_id AS account, p.access_ended_at IS NOT NULL AS ended,
                e.leaving_reason AS reason, e.eligible_for_rehire AS rehire
           FROM people.person p
           JOIN people.employment_period e ON e.tenant_id = p.tenant_id AND e.person_id = p.id
          WHERE p.tenant_id = $1::uuid AND p.status IN ('terminated', 'notice')
          ORDER BY p.work_email`,
        [TENANT],
      )) as unknown as Record<string, unknown>[];
      const m = (who: string) => `${who}@meridianfreight.example`;
      const left = (email: string, day: string, reason: string) => ({
        email: m(email),
        status: 'terminated',
        day,
        account: null,
        ended: true,
        reason,
        rehire: true,
      });
      const notice = (email: string) => ({
        email: m(email),
        status: 'notice',
        day: AHEAD,
        account: null,
        ended: false,
        // Notice carries its reason on the status change; the period takes
        // one, and the rehire flag, when HR confirms the termination.
        reason: null,
        rehire: null,
      });
      expect(leavers).toEqual([
        left('hunter.nelson', '2025-12-19', 'end_of_contract'),
        left('jonas.fischer', '2010-11-05', 'resigned'),
        left('joseph.robinson', '2009-03-15', 'resigned'),
        left('karen.smith', '2022-10-27', 'resigned'),
        left('linda.campbell', '2024-05-18', 'dismissed'),
        notice('michelle.martin'),
        notice('steven.rodriguez'),
      ]);
      // Effective from the dates, with HR's note the file's own words; access
      // ended at the end of the last day, as the hourly job would have.
      const [linda] = (await client.unsafe(
        `SELECT o.envelope->>'effectiveFrom' AS "from", o.envelope->'payload'->>'reason' AS note,
                (SELECT a.envelope->'payload'->>'trigger' FROM people.outbox a
                  WHERE a.aggregate_id = o.aggregate_id AND a.event_name = 'people.person.access_ended') AS trigger
           FROM people.outbox o JOIN people.person p ON p.id::text = o.aggregate_id
          WHERE p.work_email = $1 AND o.event_name = 'people.person.terminated'`,
        [m('linda.campbell')],
      )) as unknown as { from: string; note: string; trigger: string }[];
      expect(linda).toEqual({
        from: '2024-05-18',
        note: 'Involuntary - restructuring',
        trigger: 'last_working_day_ended',
      });
      // On leave from the day their leave began; the leave's own columns are fields.
      const away = (await client.unsafe(
        `SELECT p.work_email AS email, p.status, o.envelope->>'effectiveFrom' AS "from",
                p.custom ? 'leave_type' AS kept
           FROM people.person p JOIN people.outbox o ON o.aggregate_id = p.id::text
          WHERE p.tenant_id = $1::uuid AND o.event_name = 'people.person.status_changed'
            AND o.envelope->'payload'->>'reason' = 'leave_started'
          ORDER BY p.work_email`,
        [TENANT],
      )) as unknown as Record<string, unknown>[];
      expect(away).toEqual([
        { email: m('barbara.moore2'), status: 'on_leave', from: '2026-06-05', kept: true },
        { email: m('keisha.harris'), status: 'on_leave', from: '2026-06-11', kept: true },
        { email: m('maria.sanchez2'), status: 'on_leave', from: '2026-09-02', kept: true },
      ]);
      // Nothing of the lifecycle's became a field.
      const [fieldsOf] = (await client.unsafe(
        `SELECT count(*)::int AS n FROM people.attribute_definition
          WHERE tenant_id = $1::uuid
            AND key IN ('employment_status', 'termination_date', 'termination_reason', 'eligible_for_rehire')`,
        [TENANT],
      )) as unknown as { n: number }[];
      expect(fieldsOf?.n).toBe(0);
    } finally {
      await client.end();
    }
  });
});
