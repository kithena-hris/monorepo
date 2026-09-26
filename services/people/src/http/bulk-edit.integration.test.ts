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
import { yogaOptions } from '../graphql/schema.js';
import { drizzlePersonRepository } from '../infrastructure/drizzle-person-repository.js';
import { drizzleSchemaRepository } from '../infrastructure/drizzle-schema-repository.js';
import { tenantTransaction } from '../infrastructure/unit-of-work.js';
import { wirePeople } from './server.js';

/**
 * Bulk edit (PEO-071), booted as `main.ts` boots People, over Postgres: the
 * preview keeps nothing and says what the commit will do, a commit is one
 * ordinary write per person and atomic per person, and nothing the single
 * write path refuses gets through.
 */

const ACME = '00000000-0000-4000-8000-00000000000a';
const ADA = '00000000-0000-4000-8000-0000000000a1';
const MARCO = '00000000-0000-4000-8000-0000000000a2';
const MARCO_ACCOUNT = '00000000-0000-4000-8000-0000000000b2';
const HR_ACCOUNT = '00000000-0000-4000-8000-0000000000b3';
const ON = '2026-09-01';

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
    '20260924270100_people_entitlements.sql',
    '20260924270200_people_role_grant.sql',
    '20260924330000_people_identifier_review.sql',
    '20260926143000_people_duplicates.sql',
    '20260926160000_people_scim.sql',
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
        define({ key: 'job_title', effectiveDated: true, visibility: ['manager', 'hr'] }),
        define({ key: 'badge_code', uniqueScope: 'tenant' }),
        define({ key: 'desk_phone' }),
        // The employee's to fill in, not HR's.
        define({ key: 'nickname', ownership: ['employee'] }),
        // PEO-077: a change waits for a second HR member, unless HR applies it without.
        define({ key: 'pay_grade', requiresApproval: true }),
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
  const listening = server as Server | undefined;
  if (listening) await new Promise((resolve) => listening.close(resolve));
  for (const c of clients) await c.end();
  await stopPg?.();
});

type Row = {
  personId: string;
  outcome: string;
  changes: { key: string; dated: boolean; before: unknown; after: unknown }[];
  refusal: { code: string; keys: string[] } | null;
};

const post = async (path: string, body: unknown, as = hr, key: string | null = null) => {
  const response = await fetch(`${base}/v1/views/bulk-edit${path}`, {
    method: 'POST',
    headers: { ...as, ...(key === null ? {} : { 'idempotency-key': key }) },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    body: (await response.json()) as { committed?: boolean; rows: Row[] },
  };
};

/** The superuser connection `beforeAll` opened first. */
const superuser = () => {
  const client = clients[0];
  if (client === undefined) throw new Error('the admin client is not connected');
  return client;
};

/** Every `profile_updated` People has raised, for one person. */
const updates = async (personId: string) =>
  Number(
    (
      await superuser().unsafe<{ n: string }[]>(
        `SELECT count(*) AS n FROM people.outbox
          WHERE event_name = 'people.person.profile_updated' AND aggregate_id = '${personId}'`,
      )
    )[0]?.n,
  );

const outcomes = (rows: Row[]) => rows.map((r) => [r.personId, r.outcome, r.refusal?.code ?? null]);

describe('bulk edit of a field that requires approval (PEO-077)', () => {
  it('holds each value for approval, or applies it when HR says so, and says which', async () => {
    const held = await post(
      '',
      { personIds: [ADA], values: { pay_grade: 'G7' }, effectiveFrom: ON },
      hr,
      'grade-held',
    );
    expect(held.status).toBe(200);
    expect(held.body.rows[0]).toMatchObject({ outcome: 'held', held: ['pay_grade'], changes: [] });
    const pending = await fetch(`${base}/v1/people/${ADA}/pending-changes`, { headers: hr });
    expect(((await pending.json()) as { items: unknown[] }).items).toHaveLength(1);

    const applied = await post(
      '',
      {
        personIds: [MARCO],
        values: { pay_grade: 'G8' },
        effectiveFrom: ON,
        applySensitiveWithoutApproval: true,
      },
      hr,
      'grade-applied',
    );
    expect(applied.body.rows[0]).toMatchObject({ outcome: 'changed', held: [] });
    const events = await superuser().unsafe<
      { envelope: { payload: { appliedWithoutApproval?: string[] } } }[]
    >(
      `SELECT envelope FROM people.outbox
        WHERE event_name = 'people.person.profile_updated' AND aggregate_id = '${MARCO}'
        ORDER BY created_at DESC, event_id DESC LIMIT 1`,
    );
    expect(events[0]?.envelope.payload.appliedWithoutApproval).toEqual(['pay_grade']);
  });
});

describe('bulk edit (PEO-071)', () => {
  it('previews exactly what would change, keeping nothing', async () => {
    const before = await updates(ADA);
    const seen = await post('/preview', {
      personIds: [ADA, MARCO],
      values: { job_title: 'Engineer', desk_phone: '100' },
      effectiveFrom: ON,
    });
    expect(seen.status).toBe(200);
    expect(seen.body).toMatchObject({ committed: false });
    expect(outcomes(seen.body.rows)).toEqual([
      [ADA, 'changed', null],
      [MARCO, 'changed', null],
    ]);
    expect(seen.body.rows[0]?.changes).toEqual([
      expect.objectContaining({ key: 'job_title', dated: true, before: null, after: 'Engineer' }),
      expect.objectContaining({ key: 'desk_phone', dated: false, before: null, after: '100' }),
    ]);
    expect(await updates(ADA)).toBe(before);
    const read = await fetch(`${base}/v1/people/${ADA}`, { headers: hr });
    expect(
      ((await read.json()) as { attributes: Record<string, unknown> }).attributes,
    ).not.toHaveProperty('job_title');
  });

  it('is atomic per person: a value one person claims first is refused for the next, in the preview and the commit alike', async () => {
    const edit = { personIds: [ADA, MARCO], values: { badge_code: 'B-1' }, effectiveFrom: ON };
    const seen = await post('/preview', edit);
    const expected = [
      [ADA, 'changed', null],
      [MARCO, 'refused', 'UNIQUE_VALUE_TAKEN'],
    ];
    expect(outcomes(seen.body.rows)).toEqual(expected);

    const [ada, marco] = [await updates(ADA), await updates(MARCO)];
    const done = await post('', edit, hr, 'bulk-1');
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ committed: true });
    expect(outcomes(done.body.rows)).toEqual(expected);
    expect([await updates(ADA), await updates(MARCO)]).toEqual([ada + 1, marco]);

    // A retry writes nothing twice: what the first wrote now stands.
    const again = await post('', edit, hr, 'bulk-1');
    expect(outcomes(again.body.rows)).toEqual([
      [ADA, 'unchanged', null],
      [MARCO, 'refused', 'UNIQUE_VALUE_TAKEN'],
    ]);
    expect([await updates(ADA), await updates(MARCO)]).toEqual([ada + 1, marco]);
  });

  it('refuses what the single write path refuses, and says why', async () => {
    const seen = await post('/preview', {
      personIds: [ADA],
      values: { nickname: 'Ace', hire_date: '2026-02-01' },
      effectiveFrom: ON,
    });
    expect(seen.body.rows[0]?.refusal).toMatchObject({ code: 'LIFECYCLE_FIELD' });
    const mine = await post('/preview', {
      personIds: [ADA, '00000000-0000-4000-8000-0000000000ff'],
      values: { nickname: 'Ace' },
      effectiveFrom: ON,
    });
    expect(outcomes(mine.body.rows)).toEqual([
      [ADA, 'refused', 'FIELD_NOT_WRITABLE'],
      ['00000000-0000-4000-8000-0000000000ff', 'refused', 'NOT_FOUND'],
    ]);
  });

  it('is HR’s, and bounded', async () => {
    const edit = { personIds: [ADA], values: { desk_phone: '1' }, effectiveFrom: ON };
    const manager = await post('/preview', edit, headers(MARCO_ACCOUNT));
    expect(manager.status).toBe(403);
    const ids = Array.from(
      { length: 51 },
      (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    );
    expect((await post('/preview', { ...edit, personIds: ids })).status).toBe(422);
  });

  it('previews and commits over GraphQL', async () => {
    const graph = async (query: string) =>
      (await (
        await fetch(`${base}/graphql`, {
          method: 'POST',
          headers: hr,
          body: JSON.stringify({ query }),
        })
      ).json()) as { data: Record<string, { committed: boolean; rows: Row[] }> };
    const args = `personIds: ["${MARCO}"], values: [{ key: "desk_phone", text: "200" }], effectiveFrom: "${ON}"`;
    const seen = await graph(
      `{ peopleBulkEditPreview(${args}) { committed rows { personId outcome changes { key after { ... on TextEntry { text } } } } } }`,
    );
    expect(seen.data['peopleBulkEditPreview']).toEqual({
      committed: false,
      rows: [
        {
          personId: MARCO,
          outcome: 'changed',
          changes: [{ key: 'desk_phone', after: { text: '200' } }],
        },
      ],
    });
    const done = await graph(
      `mutation { bulkEditPeople(${args}, idempotencyKey: "g-1") { committed rows { outcome } } }`,
    );
    expect(done.data['bulkEditPeople']).toEqual({
      committed: true,
      rows: [{ outcome: 'changed' }],
    });
  });
});
