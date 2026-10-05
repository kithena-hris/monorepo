import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { performance } from 'node:perf_hooks';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
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
 * Review's decision queues at a company's scale, booted as `main.ts` boots
 * People against a real Postgres: N changes waiting, N doubted identifiers,
 * N suspected duplicate pairs, N requests for full values and N export sends,
 * each past every page People ever read at once.
 *
 * Each waiting count is the true total, a queue's first page is a page, and
 * paging on from the last page's place reaches every item once. What each
 * read costs, in bytes and milliseconds, is printed: the first page's, and
 * the waiting read's.
 *
 * PEOPLE_QUEUE_SCALE_N measures a bigger run by hand (10,000); CI runs 300,
 * past every old cap (200 changes, 100 ID checks, 50 of everything else).
 */

const N = Number(process.env['PEOPLE_QUEUE_SCALE_N'] ?? 300);
const PAGE = 50;
const ACME = '00000000-0000-4000-8000-00000000000a';
const HR = '00000000-0000-4000-8000-0000000000b1';
const OTHER_HR = '00000000-0000-4000-8000-0000000000b2';
const RECIPIENT = '00000000-0000-4000-8000-0000000000b3';

let stopPg: (() => Promise<void>) | undefined;
const clients: ReturnType<typeof postgres>[] = [];
let admin: PostgresJsDatabase;
let server: Server;
let base = '';

const headers = {
  'content-type': 'application/json',
  'x-internal-token': 'router-secret',
  'x-kithena-principal': JSON.stringify({
    userId: HR,
    tenantId: ACME,
    roles: ['hr', 'people_admin'],
    entitlements: ['module.people'],
  }),
};

const migration = (file: string): Promise<string> =>
  readFile(new URL(`../../../../migrations/${file}`, import.meta.url), 'utf8');

/** `<prefix>-<12 digits of i>`: a uuid per row, in order. */
const id = (prefix: string) =>
  sql.raw(`('00000000-0000-4000-${prefix}-' || lpad(g::text, 12, '0'))::uuid`);

beforeAll(async () => {
  const pg = await startPostgres();
  stopPg = pg.stop;
  const adminClient = postgres(pg.url, { max: 1 });
  clients.push(adminClient);
  admin = drizzle(adminClient);
  for (const file of [
    '20260821120000_tenant_registry.sql',
    '20260922140000_people_bootstrap.sql',
    '20260922160000_people_registry.sql',
    '20260926140000_people_visibility_rules.sql',
    '20260926180000_people_pending_change.sql',
    '20260926230000_people_pending_change_decided_as.sql',
    '20261001170000_people_approval_flags.sql',
    '20260922170000_people_person.sql',
    '20260924220000_people_access_end.sql',
    '20260926143000_people_duplicates.sql',
    '20260924150000_people_unique_hash.sql',
    '20260927143500_people_unmerge.sql',
    '20260924220200_people_employment_period.sql',
    '20260923110000_people_completeness.sql',
    '20260923120000_people_webhooks.sql',
    '20260924120100_people_webhook_alerts.sql',
    '20260924170000_people_calendar.sql',
    '20261005090000_people_org_unit.sql',
    '20261005120000_people_section_names.sql',
    '20260924170100_people_tenant_company.sql',
    '20260924270100_people_entitlements.sql',
    '20260924270200_people_role_grant.sql',
    '20260924330000_people_identifier_review.sql',
    '20260926230100_people_identifier_review_held.sql',
    '20260924360000_people_import_upload.sql',
    '20260926160000_people_scim.sql',
    '20260926190000_people_pay.sql',
    '20260927161000_people_person_photo.sql',
    '20260927170000_people_detail_request.sql',
    '20260927180000_people_files.sql',
    '20260923200000_people_export.sql',
    '20260924160000_people_full_values.sql',
    '20261001150000_people_export_share.sql',
    '20261004100000_people_export_share_people.sql',
    '20261004122000_people_pending_change_decided_page.sql',
    '20261004124000_people_duplicate_merges_page.sql',
    // Absent before Review paged: a run against the old code skips it.
    ...(process.env['PEOPLE_QUEUE_SCALE_BEFORE'] === '1'
      ? []
      : [
          '20261005140000_people_review_queue_pages.sql',
          '20261005160000_people_pending_change_flag_evidence.sql',
        ]),
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
  const internal = {
    classification: 'internal',
    piiKind: 'none',
    exportable: true,
    aiEligible: false,
  } as const;
  await inTenant(ACME, ({ tx }) =>
    drizzleSchemaRepository().appendVersion(
      tx,
      ACME,
      versionOf(1, [
        define({
          key: 'department',
          label: { default: 'Department' },
          visibility: ['self', 'hr', 'manager'],
          ownership: ['hr'],
          requiresApproval: true,
          classification: internal,
        }),
        // Pay only a person's managers read, not HR (MANAGER_PAY): anybody
        // above them, and their own manager alone.
        define({
          key: 'base_salary',
          label: { default: 'Base salary' },
          dataType: 'money',
          typeConfig: { kind: 'money' },
          visibility: ['self', 'manager', 'manager_chain'],
          ownership: ['hr'],
          requiresApproval: true,
          classification: internal,
        }),
        define({
          key: 'bonus',
          label: { default: 'Bonus' },
          dataType: 'money',
          typeConfig: { kind: 'money' },
          visibility: ['self', 'manager'],
          ownership: ['hr'],
          requiresApproval: true,
          classification: internal,
        }),
        define({
          key: 'es_nif',
          label: { default: 'NIF' },
          visibility: ['self', 'hr'],
          ownership: ['hr'],
          classification: internal,
        }),
        define({
          key: 'work_email',
          label: { default: 'Work email' },
          visibility: ['self', 'hr'],
          ownership: ['hr'],
          classification: internal,
        }),
      ]),
      [],
      '2026-09-01',
    ),
  );

  // Seeded as rows, a set at a time: N people, each with a change waiting, a
  // doubted identifier, and a twin sharing their work email.
  await admin.execute(sql`
    INSERT INTO people.person (id, tenant_id, status, given_name, family_name, work_email)
    SELECT ${id('a000')}, ${ACME}::uuid, 'active', 'Person', 'P' || g, 'p' || g || '@acme.test'
      FROM generate_series(1, ${N}) g`);
  await admin.execute(sql`
    INSERT INTO people.person (id, tenant_id, status, given_name, family_name, work_email)
    SELECT ${id('b000')}, ${ACME}::uuid, 'active', 'Twin', 'T' || g, 'p' || g || '@acme.test'
      FROM generate_series(1, ${N}) g`);
  await admin.execute(sql`
    INSERT INTO people.pending_change
           (tenant_id, id, person_id, attribute_key, kind, sealed, value, effective_from,
            requested_by, requested_at, expires_at, state)
    SELECT ${ACME}::uuid, ${id('c000')}, ${id('a000')}, 'department', 'value', false,
           to_jsonb('team ' || g), '2026-12-01', ${OTHER_HR}::uuid,
           now() - g * interval '1 minute', now() + interval '6 days', 'pending'
      FROM generate_series(1, ${N}) g`);
  await admin.execute(sql`
    INSERT INTO people.person_attribute_history
           (id, tenant_id, person_id, attribute_key, value, effective_from, actor)
    SELECT ${id('d000')}, ${ACME}::uuid, ${id('a000')}, 'es_nif', to_jsonb('X' || g),
           '2026-09-01', '{"kind":"system","process":"seed"}'::jsonb
      FROM generate_series(1, ${N}) g`);
  await admin.execute(sql`
    INSERT INTO people.identifier_review
           (tenant_id, id, person_id, attribute_key, history_id, findings, value_hash, key_id,
            state, created_at)
    SELECT ${ACME}::uuid, ${id('e000')}, ${id('a000')}, 'es_nif', ${id('d000')},
           '[{"level":"mismatch","code":"checksum","message":"does not compute"}]'::jsonb,
           'h' || g, 'k1', 'pending', now() - g * interval '1 minute'
      FROM generate_series(1, ${N}) g`);
  await admin.execute(sql`
    INSERT INTO people.full_values_request
           (tenant_id, id, requested_by, requested_at, reason, attribute_keys, expires_at, state)
    SELECT ${ACME}::uuid, ${id('f000')}, ${OTHER_HR}::uuid, now() - g * interval '1 minute',
           'Payroll audit', ARRAY['es_nif'], now() + interval '6 days', 'pending'
      FROM generate_series(1, ${N}) g`);
  await admin.execute(sql`
    INSERT INTO people.export_share
           (tenant_id, id, requested_by, recipient, reason, requested_at, expires_at, state,
            choice, gap, people)
    SELECT ${ACME}::uuid, ${id('9000')}, ${OTHER_HR}::uuid, ${RECIPIENT}::uuid, 'Headcount',
           now() - g * interval '1 minute', now() + interval '6 days', 'pending',
           '{"format":"csv","fields":["department"],"reason":"Headcount"}'::jsonb,
           '{"fields":[],"unlisted":0}'::jsonb, 6
      FROM generate_series(1, ${N}) g`);
  // Every other change flagged, as its checks would keep it: a 38% raise.
  if (process.env['PEOPLE_QUEUE_SCALE_BEFORE'] !== '1') {
    await admin.execute(sql`
      UPDATE people.pending_change
         SET flag_evidence = CASE WHEN right(id::text, 1)::int % 2 = 0
                                  THEN '[{"code":"raise","magnitude":"38"}]'::jsonb
                                  ELSE '[]'::jsonb END
       WHERE tenant_id = ${ACME}::uuid`);
  }
  await admin.execute(sql`ANALYZE`);

  process.env['PEOPLE_SECRET_KEYS'] = `k1:${randomBytes(32).toString('base64')}`;
  process.env['PEOPLE_DATABASE_URL'] = asService.toString();
  process.env['PEOPLE_API_TOKEN'] = 'router-secret';
  const yoga = createYoga(yogaOptions);
  server = createServer((request, response) => {
    void yoga(request, response);
  });
  wirePeople(server);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
}, 600_000);

afterAll(async () => {
  const listening = server as Server | undefined;
  if (listening) await new Promise((resolve) => listening.close(resolve));
  for (const c of clients) await c.end();
  await stopPg?.();
});

/** One read: its body, its size in bytes and how long it took, warm (the second of two). */
/** A read, its body as the caller names it: what People answers is checked by the assertions. */
type Read<T> = { readonly body: T; readonly bytes: number; readonly ms: number };

async function get(path: string, as: Record<string, string> = headers): Promise<Read<never>> {
  await fetch(`${base}${path}`, { headers: as });
  const at = performance.now();
  const response = await fetch(`${base}${path}`, { headers: as });
  const text = await response.text();
  const ms = performance.now() - at;
  if (response.status !== 200) throw new Error(`${path}: ${String(response.status)} ${text}`);
  return { body: JSON.parse(text) as never, bytes: Buffer.byteLength(text), ms };
}

const kb = (bytes: number) => `${(bytes / 1024).toFixed(0)} kB`;

describe(`Review's queues at ${String(N)} waiting of each kind`, () => {
  it('reads a page of each queue and every count, and says what each costs', async () => {
    const reads: {
      waiting: Read<Record<string, number | null>>;
      approvals: Read<{ items: unknown[] }>;
      identifiers: Read<{ items: unknown[] }>;
      duplicates: Read<{ items: unknown[] }>;
      fullValues: Read<{ requests: unknown[] }>;
      shares: Read<unknown[]>;
    } = {
      waiting: await get('/v1/views/waiting'),
      approvals: await get('/v1/views/approvals'),
      identifiers: await get('/v1/views/identifier-reviews'),
      duplicates: await get('/v1/views/duplicates'),
      fullValues: await get('/v1/exports/full-values'),
      shares: await get('/v1/exports/share'),
    };
    const counts = reads.waiting.body;
    const listed = {
      approvals: reads.approvals.body.items.length,
      identifiers: reads.identifiers.body.items.length,
      duplicates: reads.duplicates.body.items.length,
      fullValues: reads.fullValues.body.requests.length,
      shares: reads.shares.body.length,
    };
    // Straight to the output: People's logger takes the console over once it boots.
    process.stderr.write(
      `queues at ${String(N)} ` +
        JSON.stringify({
          counts: {
            changes: counts['changes'],
            identifiers: counts['identifiers'],
            duplicates: counts['duplicates'],
            accessRequests: counts['accessRequests'],
            exports: counts['exports'],
          },
          listed,
          cost: Object.fromEntries(
            Object.entries(reads).map(([k, r]) => [k, `${kb(r.bytes)}, ${r.ms.toFixed(0)} ms`]),
          ),
        }) +
        '\n',
    );
    expect({
      changes: counts['changes'],
      identifiers: counts['identifiers'],
      duplicates: counts['duplicates'],
      accessRequests: counts['accessRequests'],
      exports: counts['exports'],
    }).toEqual({ changes: N, identifiers: N, duplicates: N, accessRequests: N, exports: N });
    for (const n of Object.values(listed)) expect(n).toBeLessThanOrEqual(PAGE);
  }, 300_000);

  it('pages on from each last place to every item, once', async () => {
    const pages = async (
      path: (after: string | null) => string,
      take: (body: never) => { keys: string[]; next: string | null },
    ): Promise<Set<string>> => {
      const seen = new Set<string>();
      let after: string | null = null;
      let reads = 0;
      do {
        const { body } = await get(path(after));
        const page = take(body);
        for (const k of page.keys) seen.add(k);
        after = page.next;
        reads += 1;
      } while (after !== null && reads < N);
      return seen;
    };
    const q = (name: string, after: string | null) =>
      after === null ? '' : `?${name}=${encodeURIComponent(after)}`;
    const changes = await pages(
      (after) => `/v1/views/approvals${q('after', after)}`,
      (b: { items: { id: string }[]; itemsNext: string | null }) => ({
        keys: b.items.map((i) => i.id),
        next: b.itemsNext,
      }),
    );
    const identifiers = await pages(
      (after) => `/v1/views/identifier-reviews${q('after', after)}`,
      (b: { items: { personId: string }[]; next: string | null }) => ({
        keys: b.items.map((i) => i.personId),
        next: b.next,
      }),
    );
    const duplicates = await pages(
      (after) => `/v1/views/duplicates${q('after', after)}`,
      (b: { items: { personIds: string[] }[]; next: string | null }) => ({
        keys: b.items.map((i) => i.personIds.join('~')),
        next: b.next,
      }),
    );
    const requests = await pages(
      (after) => `/v1/exports/full-values${q('before', after)}`,
      (b: { requests: { id: string }[]; next?: string | null }) => ({
        keys: b.requests.map((r) => r.id),
        next: b.next ?? null,
      }),
    );
    const shares = await pages(
      (after) => `/v1/exports/share/waiting${q('after', after)}`,
      (b: { items: { id: string }[]; next: string | null }) => ({
        keys: b.items.map((s) => s.id),
        next: b.next,
      }),
    );
    expect([changes.size, identifiers.size, duplicates.size, requests.size, shares.size]).toEqual([
      N,
      N,
      N,
      N,
      N,
    ]);
  }, 600_000);

  it('counts and pages Flagged over every change its checks flag, marks applied in the query', async () => {
    const flagged = Math.floor(N / 2);
    const counted = async () =>
      ((await get('/v1/views/waiting')) as Read<{ flagged: number | null }>).body.flagged;
    const at = performance.now();
    const before = await counted();
    const ms = performance.now() - at;
    const first: Read<{ items: { id: string }[]; itemsNext: string | null }> = await get(
      '/v1/views/approvals?flagged=1',
    );
    process.stderr.write(
      `flagged at ${String(N)} ${JSON.stringify({ count: before, waiting: `${(ms).toFixed(0)} ms`, firstPage: `${kb(first.bytes)}, ${first.ms.toFixed(0)} ms` })}\n`,
    );
    expect(before).toBe(flagged);
    const ids = new Set<string>();
    let after: string | null = null;
    let reads = 0;
    do {
      const page: Read<{ items: { id: string }[]; itemsNext: string | null }> = await get(
        `/v1/views/approvals?flagged=1${after === null ? '' : `&after=${encodeURIComponent(after)}`}`,
      );
      for (const i of page.body.items) ids.add(i.id);
      after = page.body.itemsNext;
      reads += 1;
    } while (after !== null && reads < N);
    // The hour's newest are on the first page whatever their evidence (close colleagues).
    const recent = 60;
    expect(ids.size).toBeGreaterThanOrEqual(flagged);
    expect(ids.size).toBeLessThanOrEqual(flagged + recent / 2 + 1);
    // "Not unusual" on one of them, as big as the raises: every one of the requester's quiet now.
    const change = `00000000-0000-4000-c000-${String(2).padStart(12, '0')}`;
    await admin.execute(sql`
      INSERT INTO people.approval_flag_mark
             (tenant_id, change_id, code, requested_by, magnitude, marked_by, marked_at)
      VALUES (${ACME}::uuid, ${change}::uuid, 'raise', ${OTHER_HR}::uuid, 30, ${HR}::uuid, now())`);
    expect(await counted()).toBe(flagged);
    await admin.execute(sql`
      UPDATE people.approval_flag_mark SET magnitude = 40 WHERE tenant_id = ${ACME}::uuid`);
    expect(await counted()).toBe(0);
    await admin.execute(sql`DELETE FROM people.approval_flag_mark WHERE tenant_id = ${ACME}::uuid`);
  }, 600_000);

  it('opens a change and a person’s ID check far down their queues, alone', async () => {
    const change = `00000000-0000-4000-c000-${String(N).padStart(12, '0')}`;
    const person = `00000000-0000-4000-a000-${String(N).padStart(12, '0')}`;
    const one: Read<{ items: { id: string }[] }> = await get(
      `/v1/views/approvals?change=${change}`,
    );
    expect(one.body.items.map((i) => i.id)).toEqual([change]);
    const theirs: Read<{ items: { personId: string }[] }> = await get(
      `/v1/views/identifier-reviews?person=${person}`,
    );
    expect(theirs.body.items.map((i) => i.personId)).toEqual([person]);
  });

  it('counts pay only a manager reads for whom the decider’s line reaches, in the query', async () => {
    // HR signs in as Boss: ten reports, the rest of the first half below
    // them, the second half under somebody else.
    const BOSS = '00000000-0000-4000-7000-000000000001';
    const ELSEWHERE = '00000000-0000-4000-7000-000000000002';
    const half = Math.floor(N / 2);
    await admin.execute(sql`
      INSERT INTO people.person (id, tenant_id, status, given_name, family_name, identity_account_id)
      VALUES (${BOSS}::uuid, ${ACME}::uuid, 'active', 'Boss', 'B', ${HR}::uuid),
             (${ELSEWHERE}::uuid, ${ACME}::uuid, 'active', 'Other', 'O', NULL)`);
    await admin.execute(sql`
      UPDATE people.person p
         SET manager_id = CASE
               WHEN g <= 10 THEN ${BOSS}::uuid
               WHEN g <= ${half} THEN ('00000000-0000-4000-a000-' || lpad(((g % 10) + 1)::text, 12, '0'))::uuid
               ELSE ${ELSEWHERE}::uuid END
        FROM generate_series(1, ${N}) g
       WHERE p.tenant_id = ${ACME}::uuid AND p.id = ${id('a000')}`);
    // A raise to each person's base salary and bonus, kept flagged, asked for hours ago.
    for (const [key, prefix] of [
      ['base_salary', '7100'],
      ['bonus', '7200'],
    ] as const) {
      await admin.execute(sql`
        INSERT INTO people.pending_change
               (tenant_id, id, person_id, attribute_key, kind, sealed, value, effective_from,
                requested_by, requested_at, expires_at, state, flag_evidence)
        SELECT ${ACME}::uuid, ${id(prefix)}, ${id('a000')}, ${key}, 'value', false,
               '{"amountMinor":"8400000","currency":"EUR"}'::jsonb, '2026-12-01', ${OTHER_HR}::uuid,
               now() - interval '2 hours' - g * interval '1 minute', now() + interval '6 days',
               'pending', '[{"code":"raise","magnitude":"38"}]'::jsonb
          FROM generate_series(1, ${N}) g`);
    }
    await admin.execute(sql`ANALYZE`);

    const department = Math.floor(N / 2);
    const leo = {
      ...headers,
      'x-kithena-principal': JSON.stringify({
        userId: RECIPIENT,
        tenantId: ACME,
        roles: ['hr'],
        entitlements: ['module.people'],
      }),
    };
    const counted = async (as = headers) => {
      const read = (await get('/v1/views/waiting', as)) as Read<{ flagged: number | null }>;
      return { count: read.body.flagged, ms: read.ms };
    };
    const listed = async () => {
      const ids: string[] = [];
      let after: string | null = null;
      let reads = 0;
      do {
        const page: Read<{ items: { id: string }[]; itemsNext: string | null }> = await get(
          `/v1/views/approvals?flagged=1${after === null ? '' : `&after=${encodeURIComponent(after)}`}`,
        );
        ids.push(...page.body.items.map((i) => i.id));
        after = page.body.itemsNext;
        reads += 1;
      } while (after !== null && reads < 3 * N);
      return {
        salary: ids.filter((i) => i.includes('-7100-')).length,
        bonus: ids.filter((i) => i.includes('-7200-')).length,
      };
    };

    // Counted (the default): base salary on everybody below Boss, bonus on their ten reports.
    const on = await counted();
    expect(on.count).toBe(department + half + 10);
    expect(await listed()).toEqual({ salary: half, bonus: 10 });
    // HR with nobody below them reads neither.
    expect((await counted(leo)).count).toBe(department);

    // Switched off: unread for everybody, from the next read.
    await admin.execute(sql`
      INSERT INTO people.approval_check (tenant_id, code, enabled, set_by, set_at)
      VALUES (${ACME}::uuid, 'manager_pay', false, ${HR}::uuid, now())`);
    const off = await counted();
    process.stderr.write(
      `manager pay at ${String(N)} ${JSON.stringify({ on: `${String(on.count)} in ${on.ms.toFixed(0)} ms`, off: `${String(off.count)} in ${off.ms.toFixed(0)} ms` })}\n`,
    );
    expect(off.count).toBe(department);
    expect(await listed()).toEqual({ salary: 0, bonus: 0 });

    await admin.execute(sql`
      DELETE FROM people.approval_check WHERE tenant_id = ${ACME}::uuid AND code = 'manager_pay'`);
    await admin.execute(sql`
      DELETE FROM people.pending_change
       WHERE tenant_id = ${ACME}::uuid AND attribute_key IN ('base_salary', 'bonus')`);
  }, 1_800_000);
});
