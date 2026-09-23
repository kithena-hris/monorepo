import { readFile } from 'node:fs/promises';

import { sql } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '@kithena/db-kit';
import { startPostgres } from '@kithena/testing';

import { accountsPage } from '../infrastructure/drizzle-account-repository.js';

/**
 * The listing's query against the real table and its row-level security:
 * one tenant's accounts and nobody else's, a page at a time, leavers left out.
 */

const TENANT = '00000000-0000-4000-8000-00000000000a';
const OTHER_TENANT = '00000000-0000-4000-8000-00000000000b';
const account = (n: number) => `00000000-0000-4000-8000-0000000000a${String(n)}`;
/** One identity per account: a person holds one live account per company. */
const identity = (n: number) => `00000000-0000-4000-8000-0000000000d${String(n)}`;

let stop: (() => Promise<void>) | undefined;
let adminClient: ReturnType<typeof postgres> | undefined;
let serviceClient: ReturnType<typeof postgres> | undefined;
let db: PostgresJsDatabase;

beforeAll(async () => {
  const started = await startPostgres();
  stop = started.stop;
  adminClient = postgres(started.url, { max: 1 });
  const admin = drizzle(adminClient);

  for (const file of [
    '20260821120000_tenant_registry.sql',
    '20260821230000_identity.sql',
    '20260919160000_account_name.sql',
  ]) {
    const path = new URL(`../../../../../migrations/${file}`, import.meta.url);
    await admin.execute(sql.raw(await readFile(path, 'utf8')));
  }

  await admin.execute(sql`
    INSERT INTO platform.tenant (id, slug, display_name, status) VALUES
      (${TENANT}::uuid, 'acme', 'Acme', 'active'),
      (${OTHER_TENANT}::uuid, 'globex', 'Globex', 'active')
  `);
  for (const n of [1, 2, 3, 4, 5]) {
    await admin.execute(sql`INSERT INTO platform.identity (id) VALUES (${identity(n)}::uuid)`);
  }
  await admin.execute(sql`
    INSERT INTO platform.account
      (id, tenant_id, identity_id, status, work_email, time_zone, employment_start, session_limit,
       given_name, family_name)
    VALUES
      (${account(1)}::uuid, ${TENANT}::uuid, ${identity(1)}::uuid, 'active',
       'ada@acme.example', 'Europe/Madrid', '2026-01-01', 4, 'Ada', 'Lovelace'),
      (${account(2)}::uuid, ${TENANT}::uuid, ${identity(2)}::uuid, 'invited',
       'grace@acme.example', 'Europe/Madrid', '2026-04-01', 4, NULL, NULL),
      (${account(3)}::uuid, ${TENANT}::uuid, ${identity(3)}::uuid, 'terminated',
       'left@acme.example', 'Europe/Madrid', '2025-01-01', 4, NULL, NULL),
      (${account(4)}::uuid, ${TENANT}::uuid, ${identity(4)}::uuid, 'provisioned',
       'new@acme.example', 'Europe/Madrid', '2026-10-01', 4, NULL, NULL),
      (${account(5)}::uuid, ${OTHER_TENANT}::uuid, ${identity(5)}::uuid, 'active',
       'ada@globex.example', 'Europe/Madrid', '2026-01-01', 4, 'Ada', 'Globex')
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
}, 180_000);

afterAll(async () => {
  await serviceClient?.end();
  await adminClient?.end();
  await stop?.();
});

const page = (tenantId: string, after: string | null, limit: number) =>
  withTenant(db, tenantId, (tx) => accountsPage(tx, after, limit));

describe('a tenant’s accounts, a page at a time', () => {
  it('walks the tenant by id, leaving out leavers and every other tenant', async () => {
    const first = await page(TENANT, null, 2);
    expect(first.map((a) => a.id)).toEqual([account(1), account(2)]);
    const rest = await page(TENANT, account(2), 2);
    expect(rest.map((a) => a.id)).toEqual([account(4)]);
  });

  it('carries the name once enrolment captured one', async () => {
    const [ada, grace] = await page(TENANT, null, 2);
    expect(ada).toMatchObject({
      workEmail: 'ada@acme.example',
      timeZone: 'Europe/Madrid',
      employmentStart: '2026-01-01',
      givenName: 'Ada',
      familyName: 'Lovelace',
    });
    expect(grace).toMatchObject({ givenName: null, familyName: null });
  });

  it('sees nothing for a tenant with no accounts', async () => {
    expect(await page('00000000-0000-4000-8000-00000000000c', null, 10)).toEqual([]);
  });
});
