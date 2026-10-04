import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { sql } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AssistantAsker } from '@kithena/contracts';
import { withTenant } from '@kithena/db-kit';
import { startPostgres } from '@kithena/testing';

import { askerAccounts } from '../infrastructure/drizzle-account-repository.js';
import { askerRoutes } from './asker-routes.js';

/**
 * Who is asking the assistant, against the real table and its row-level
 * security (assistant PRD §10.1): one active account by work email, whatever
 * its case; nobody for an email no account has, for one whose access ended,
 * or in another tenant; and the rehired account, not the one it replaced.
 */

const TENANT = '00000000-0000-4000-8000-00000000000a';
const OTHER_TENANT = '00000000-0000-4000-8000-00000000000b';
const TOKEN = 'assistant-identity-secret';
const account = (n: number) => `00000000-0000-4000-8000-0000000000a${String(n)}`;
const identity = (n: number) => `00000000-0000-4000-8000-0000000000d${String(n)}`;

let stop: (() => Promise<void>) | undefined;
let adminClient: ReturnType<typeof postgres> | undefined;
let serviceClient: ReturnType<typeof postgres> | undefined;
let db: PostgresJsDatabase;
let server: Server | undefined;
let base = '';

beforeAll(async () => {
  const started = await startPostgres();
  stop = started.stop;
  adminClient = postgres(started.url, { max: 1 });
  const admin = drizzle(adminClient);

  for (const file of [
    '20260821120000_tenant_registry.sql',
    '20260821230000_identity.sql',
    '20260919160000_account_name.sql',
    '20260822010000_enrolment_token.sql',
    '20260822100000_operator.sql',
    // `account.kind` and the support session's columns, which Drizzle reads.
    '20260929130000_support_access.sql',
    '20260929170000_view_as.sql',
  ]) {
    const path = new URL(`../../../../../migrations/${file}`, import.meta.url);
    await admin.execute(sql.raw(await readFile(path, 'utf8')));
  }

  await admin.execute(sql`
    INSERT INTO platform.tenant (id, slug, display_name, status) VALUES
      (${TENANT}::uuid, 'acme', 'Acme', 'active'),
      (${OTHER_TENANT}::uuid, 'globex', 'Globex', 'active')
  `);
  for (const n of [1, 2, 3, 4, 5, 6]) {
    await admin.execute(sql`INSERT INTO platform.identity (id) VALUES (${identity(n)}::uuid)`);
  }
  await admin.execute(sql`
    INSERT INTO platform.account
      (id, tenant_id, identity_id, status, work_email, time_zone, employment_start, session_limit,
       given_name, family_name)
    VALUES
      (${account(1)}::uuid, ${TENANT}::uuid, ${identity(1)}::uuid, 'active',
       'Ada@Acme.example', 'Europe/Madrid', '2026-01-01', 4, 'Ada', 'Lovelace'),
      (${account(2)}::uuid, ${TENANT}::uuid, ${identity(2)}::uuid, 'invited',
       'grace@acme.example', 'Europe/Madrid', '2026-04-01', 4, NULL, NULL),
      (${account(3)}::uuid, ${TENANT}::uuid, ${identity(3)}::uuid, 'suspended',
       'ended@acme.example', 'Europe/Madrid', '2025-01-01', 4, NULL, NULL),
      (${account(4)}::uuid, ${TENANT}::uuid, ${identity(4)}::uuid, 'terminated',
       'rehired@acme.example', 'Europe/Madrid', '2024-01-01', 4, NULL, NULL),
      (${account(5)}::uuid, ${TENANT}::uuid, ${identity(5)}::uuid, 'active',
       'rehired@acme.example', 'America/New_York', '2026-06-01', 4, NULL, NULL),
      (${account(6)}::uuid, ${OTHER_TENANT}::uuid, ${identity(6)}::uuid, 'active',
       'ada@acme.example', 'Asia/Tokyo', '2026-01-01', 4, 'Ada', 'Globex')
  `);
  // A non-superuser, so row-level security is enforced rather than bypassed.
  await admin.execute(sql`CREATE ROLE svc_test LOGIN PASSWORD 'svc_test' NOBYPASSRLS`);
  await admin.execute(sql`GRANT USAGE ON SCHEMA platform TO svc_test`);
  await admin.execute(sql`GRANT SELECT ON ALL TABLES IN SCHEMA platform TO svc_test`);

  const asService = new URL(started.url);
  asService.username = 'svc_test';
  asService.password = 'svc_test';
  serviceClient = postgres(asService.toString(), { max: 2 });
  db = drizzle(serviceClient);

  const handle = askerRoutes({
    internalToken: TOKEN,
    accounts: (tenantId, email) => withTenant(db, tenantId, (tx) => askerAccounts(tx, email)),
    tenant: () => Promise.resolve({ slug: 'acme', entitlements: ['module.timeoff'] }),
  });
  server = createServer((request, response) => {
    void handle(request, response).then((handled) => {
      if (!handled) response.writeHead(404).end();
    });
  });
  await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
}, 180_000);

afterAll(async () => {
  await new Promise((resolve) => server?.close(resolve));
  await serviceClient?.end();
  await adminClient?.end();
  await stop?.();
});

const ask = (email: string, tenant = TENANT) =>
  fetch(`${base}/api/internal/tenants/${tenant}/assistant/asker`, {
    method: 'POST',
    headers: { 'x-internal-token': TOKEN },
    body: JSON.stringify({ email }),
  });

describe('who is asking the assistant, from the accounts table', () => {
  it('finds the one active account by work email, whatever its case', async () => {
    const response = await ask('ada@acme.example');
    expect(response.status).toBe(200);
    expect(AssistantAsker.parse(await response.json())).toEqual({
      accountId: account(1),
      timeZone: 'Europe/Madrid',
      slug: 'acme',
      entitlements: ['module.timeoff'],
    });
  });

  it('finds nobody for an email no account has, or one not yet enrolled', async () => {
    expect((await ask('nobody@acme.example')).status).toBe(404);
    expect((await ask('grace@acme.example')).status).toBe(404);
  });

  it('finds nobody whose access has ended', async () => {
    expect((await ask('ended@acme.example')).status).toBe(404);
  });

  it('finds the rehired account, not the terminated one it replaced', async () => {
    const response = await ask('rehired@acme.example');
    expect(AssistantAsker.parse(await response.json()).accountId).toBe(account(5));
  });

  it('never finds another tenant’s account with the same email', async () => {
    const rows = await withTenant(db, TENANT, (tx) => askerAccounts(tx, 'ada@acme.example'));
    expect(rows.map((r) => r.id)).toEqual([account(1)]);
    expect((await ask('ada@acme.example', '00000000-0000-4000-8000-00000000000c')).status).toBe(
      404,
    );
  });
});
