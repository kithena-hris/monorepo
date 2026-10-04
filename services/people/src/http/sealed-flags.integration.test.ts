import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { createYoga } from 'graphql-yoga';
import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { startObjectStore, startPostgres } from '@kithena/testing';
import { logger } from '@kithena/telemetry';

import { define, versionOf } from '../application/person/in-memory.js';
import { Person } from '../domain/person/person.js';
import { yogaOptions } from '../graphql/schema.js';
import { staticKeyRing } from '../infrastructure/envelope.js';
import { drizzlePersonRepository } from '../infrastructure/drizzle-person-repository.js';
import { drizzleSchemaRepository } from '../infrastructure/drizzle-schema-repository.js';
import { drizzleSecretStore } from '../infrastructure/secret-store.js';
import { tenantTransaction } from '../infrastructure/unit-of-work.js';
import { wirePeople } from './server.js';

/**
 * Flagged approvals on sealed pay (PEO-145), booted as `main.ts` boots People:
 * a decider who may read the field is told "A 38% raise", one who may not is
 * told nothing, and neither amount is ever written down — not in a response,
 * a table or a log line — however the change is looked at, marked or decided.
 */

const ACME = '00000000-0000-4000-8000-00000000000a';
const TOM = '00000000-0000-4000-8000-0000000000a1';
const NORA = '00000000-0000-4000-8000-0000000000b1';
const FINANCE_HR = '00000000-0000-4000-8000-0000000000b2';
const PLAIN_HR = '00000000-0000-4000-8000-0000000000b3';
const BEFORE = 6_100_000;
const AFTER = 8_400_000;
/** Every way either amount could be written: minor units, major, and as money is shown. */
const PLAINTEXT = /6100000|8400000|61000\b|84000\b|61,000|84,000|€61|€84/u;

let stopPg: (() => Promise<void>) | undefined;
let stopObjects: (() => Promise<void>) | undefined;
const clients: ReturnType<typeof postgres>[] = [];
let admin: PostgresJsDatabase;
let server: Server;
let base = '';
const logged: string[] = [];

const headers = (account: string, roles: string[], key?: string) => ({
  'content-type': 'application/json',
  'x-internal-token': 'router-secret',
  'x-kithena-principal': JSON.stringify({
    userId: account,
    tenantId: ACME,
    roles,
    entitlements: ['module.people'],
  }),
  ...(key === undefined ? {} : { 'idempotency-key': key }),
});

const migration = (file: string): Promise<string> =>
  readFile(new URL(`../../../../migrations/${file}`, import.meta.url), 'utf8');

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
    '20260924220200_people_employment_period.sql',
    '20260923110000_people_completeness.sql',
    '20260923120000_people_webhooks.sql',
    '20260924120100_people_webhook_alerts.sql',
    '20260924170000_people_calendar.sql',
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
  for (const [id, account] of [
    [TOM, null],
    ['00000000-0000-4000-8000-0000000000a2', NORA],
    ['00000000-0000-4000-8000-0000000000a3', FINANCE_HR],
    ['00000000-0000-4000-8000-0000000000a4', PLAIN_HR],
  ] as const) {
    await inTenant(ACME, ({ tx }) =>
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
        { managerId: null },
      ),
    );
  }
  await inTenant(ACME, ({ tx }) =>
    drizzleSchemaRepository().appendVersion(
      tx,
      ACME,
      versionOf(1, [
        // Sealed, read by finance (and the employee), changed only with a second person's yes.
        define({
          key: 'base_salary',
          label: { default: 'Base salary' },
          dataType: 'money',
          typeConfig: { kind: 'money' },
          encrypted: true,
          visibility: ['self', 'finance'],
          ownership: ['finance'],
          requiresApproval: true,
          classification: {
            classification: 'confidential',
            piiKind: 'financial',
            exportable: true,
            aiEligible: false,
          },
        }),
      ]),
      [],
      '2026-09-01',
    ),
  );

  // Tom's pay in force, sealed under the key People boots with.
  const key = randomBytes(32);
  process.env['PEOPLE_SECRET_KEYS'] = `k1:${key.toString('base64')}`;
  await inTenant(ACME, ({ tx }) =>
    drizzleSecretStore(staticKeyRing([{ id: 'k1', key }])).put(
      tx,
      { tenantId: ACME, personId: TOM, attributeKey: 'base_salary' },
      JSON.stringify({ amountMinor: BEFORE, currency: 'EUR' }),
    ),
  );

  // Everything People logs from here on, through the one shared logger, kept to be read.
  for (const level of ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const) {
    vi.spyOn(logger, level).mockImplementation((...args: unknown[]) => {
      logged.push(JSON.stringify(args));
    });
  }

  process.env['PEOPLE_DATABASE_URL'] = asService.toString();
  process.env['PEOPLE_API_TOKEN'] = 'router-secret';
  const yoga = createYoga(yogaOptions);
  server = createServer((request, response) => {
    void yoga(request, response);
  });
  wirePeople(server);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});

afterAll(async () => {
  vi.restoreAllMocks();
  const listening = server as Server | undefined;
  if (listening) await new Promise((resolve) => listening.close(resolve));
  for (const c of clients) await c.end();
  await stopPg?.();
  await stopObjects?.();
});

interface Item {
  id: string;
  key: string;
  readable: boolean;
  flags: { code: string; title: string; detail: string }[];
  flagSummary: string | null;
  flagNote: string | null;
}

async function inbox(account: string, roles: string[]): Promise<{ body: string; item: Item }> {
  const response = await fetch(`${base}/v1/views/approvals`, { headers: headers(account, roles) });
  const body = await response.text();
  const item = (JSON.parse(body) as { items: Item[] }).items.find((i) => i.key === 'base_salary');
  if (!item) throw new Error(`nothing waiting: ${body}`);
  return { body, item };
}

describe('flags on sealed pay (PEO-145)', () => {
  it('tells a decider who may read it the percentage, tells anybody else nothing, and writes neither amount anywhere', async () => {
    const asked = await fetch(`${base}/v1/people/${TOM}`, {
      method: 'PATCH',
      headers: headers(NORA, ['hr', 'finance'], 'raise'),
      body: JSON.stringify({
        attributes: { base_salary: { amountMinor: AFTER, currency: 'EUR' } },
        effectiveFrom: '2026-12-01',
      }),
    });
    expect(asked.status).toBe(200);

    const finance = await inbox(FINANCE_HR, ['hr', 'finance']);
    expect(finance.item.flags.map((f) => [f.code, f.title])).toEqual([['raise', 'A 38% raise']]);
    expect(finance.body).not.toMatch(PLAINTEXT);

    const plain = await inbox(PLAIN_HR, ['hr']);
    expect(plain.item.readable).toBe(false);
    expect([plain.item.flags, plain.item.flagSummary, plain.item.flagNote]).toEqual([[], null, null]);
    expect(plain.body).not.toMatch(PLAINTEXT);

    // Approving it needs a note from whoever was shown the flag.
    const decide = (key: string, note?: string) =>
      fetch(`${base}/v1/pending-changes/${finance.item.id}/decision`, {
        method: 'POST',
        headers: headers(FINANCE_HR, ['hr', 'finance'], key),
        body: JSON.stringify({ approve: true, ...(note === undefined ? {} : { note }) }),
      });
    const bare = await decide('bare');
    expect(bare.status).toBe(422);
    expect(((await bare.json()) as { error: { code: string } }).error.code).toBe('NOTE_REQUIRED');
    expect((await decide('noted', 'Promotion to Sales manager')).status).toBe(200);

    // What was kept: the check's code, never an amount.
    const [kept] = [
      ...(await admin.execute<{ flags: string[] }>(
        sql`SELECT flags FROM people.pending_change WHERE id = ${finance.item.id}::uuid`,
      )),
    ];
    expect(kept?.flags).toEqual(['raise']);

    // Nowhere in People's tables, nor in anything it logged.
    const tables = await admin.execute<{ name: string }>(
      sql`SELECT table_name AS name FROM information_schema.tables
           WHERE table_schema = 'people' AND table_type = 'BASE TABLE'`,
    );
    const found: string[] = [];
    for (const { name } of tables) {
      const rows = await admin.execute<{ row: string }>(
        sql.raw(`SELECT row_to_json(t)::text AS row FROM people."${name}" t`),
      );
      for (const { row } of rows) if (PLAINTEXT.test(row)) found.push(`${name}: ${row}`);
    }
    expect(found).toEqual([]);
    expect(logged.length).toBeGreaterThan(0);
    expect(logged.filter((line) => PLAINTEXT.test(line))).toEqual([]);
  });
});
