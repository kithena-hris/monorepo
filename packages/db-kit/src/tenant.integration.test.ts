import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { startPostgres } from '@kithena/testing';

import { withTenant, withoutTenantScope } from './tenant.js';

/**
 * Tenant isolation, against a real database.
 *
 * `PRIVACY.md` claims isolation is enforced by Postgres rather than by a
 * `WHERE` clause a future query might omit. That claim is only worth making if
 * something checks it, and it cannot be checked against a mock: a mock will
 * happily agree that a policy applies.
 */

const TENANT_A = '00000000-0000-4000-8000-00000000000a';
const TENANT_B = '00000000-0000-4000-8000-00000000000b';

// Declared possibly-undefined on purpose: if `beforeAll` throws part way
// through, `afterAll` still runs and has to clean up whatever was created. The
// optional chaining below is load-bearing, not defensive noise.
let stop: (() => Promise<void>) | undefined;
let adminClient: ReturnType<typeof postgres> | undefined;
let serviceClient: ReturnType<typeof postgres> | undefined;
let admin: PostgresJsDatabase;
let db: PostgresJsDatabase;

beforeAll(async () => {
  const started = await startPostgres();
  stop = started.stop;

  adminClient = postgres(started.url, { max: 1 });
  admin = drizzle(adminClient);

  await admin.execute(sql`
    CREATE TABLE person (
      id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id   uuid NOT NULL,
      work_email  text NOT NULL
    )
  `);
  await admin.execute(sql`ALTER TABLE person ENABLE ROW LEVEL SECURITY`);
  /*
   * FORCE, not just ENABLE. A table's owner bypasses its own policies by
   * default, and a service connects as the role that owns its schema — so
   * without this the policy exists and enforces nothing.
   */
  await admin.execute(sql`ALTER TABLE person FORCE ROW LEVEL SECURITY`);
  /*
   * NULLIF is load-bearing, and it is the detail every hand-written version of
   * this policy gets wrong.
   *
   * `set_config(..., true)` is transaction-local, and at the end of the
   * transaction the setting does not go back to unset — it goes back to the
   * empty string. `''::uuid` raises `22P02` rather than evaluating to NULL, so
   * a policy written as the obvious `current_setting(...)::uuid` does not fail
   * closed on an unscoped query: it fails *loudly*, as a 500 from a cast, on
   * every request that forgot `withTenant`. NULLIF turns that back into NULL,
   * the comparison into NULL, and the policy into a quiet, correct "no rows".
   */
  await admin.execute(sql`
    CREATE POLICY tenant_isolation ON person
      USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  `);

  await admin.execute(sql`
    INSERT INTO person (tenant_id, work_email) VALUES
      (${TENANT_A}::uuid, 'a1@example.com'),
      (${TENANT_A}::uuid, 'a2@example.com'),
      (${TENANT_B}::uuid, 'b1@example.com')
  `);

  /*
   * The assertions run as a non-superuser, because a superuser bypasses row
   * level security unconditionally — FORCE does not apply to it and neither
   * does NOBYPASSRLS. Testcontainers hands back a superuser, so a test that
   * used that connection would report perfect isolation while enforcing none.
   *
   * This is why `tools/scripts/init-db.sql` creates `svc_people` and
   * `svc_timeoff` as ordinary login roles: the connection a module opens must
   * be one the database is willing to constrain.
   */
  await admin.execute(sql`CREATE ROLE svc_test LOGIN PASSWORD 'svc_test'`);
  await admin.execute(sql`GRANT SELECT, INSERT, UPDATE, DELETE ON person TO svc_test`);

  const asService = new URL(started.url);
  asService.username = 'svc_test';
  asService.password = 'svc_test';
  // One connection, deliberately. A pool would hide the leak test below: each
  // statement could land on a different backend and never see a previous
  // transaction's settings whether they leaked or not.
  serviceClient = postgres(asService.toString(), { max: 1 });
  db = drizzle(serviceClient);
});

afterAll(async () => {
  await serviceClient?.end();
  await adminClient?.end();
  await stop?.();
});

async function emailsVisibleTo(tenantId: string): Promise<string[]> {
  return withTenant(db, tenantId, async (tx) => {
    const rows = await tx.execute(sql`SELECT work_email FROM person ORDER BY work_email`);
    return [...rows].map((row) => String(row['work_email']));
  });
}

describe('row-level security isolates tenants', () => {
  it('shows a tenant only its own rows', async () => {
    expect(await emailsVisibleTo(TENANT_A)).toEqual(['a1@example.com', 'a2@example.com']);
    expect(await emailsVisibleTo(TENANT_B)).toEqual(['b1@example.com']);
  });

  it('hides everything when no tenant is set', async () => {
    // The failure mode this prevents is a query that runs outside `withTenant`
    // and quietly returns every tenant's data.
    const rows = await db.execute(sql`SELECT work_email FROM person`);
    expect([...rows]).toHaveLength(0);
  });

  it('returns no rows rather than raising once a scope has been used and left', async () => {
    /*
     * Pins the empty-string behaviour the policy is written around. After a
     * transaction-local `set_config`, the setting is `''` and not unset, so a
     * policy casting it straight to uuid raises `22P02` here instead of
     * filtering. Asserting no-rows rather than no-error is the point: the
     * unscoped query has to be quietly empty, not a 500.
     */
    await emailsVisibleTo(TENANT_A);
    await expect(db.execute(sql`SELECT work_email FROM person`)).resolves.toHaveLength(0);
  });

  it('does not leak the tenant to the next transaction on the same connection', async () => {
    /*
     * The reason `withTenant` passes `true` to `set_config`: the setting is
     * transaction-local. Without it the value survives on the pooled backend,
     * and the next request to reuse that connection reads the previous
     * request's tenant — a cross-tenant data leak that no test of a single
     * request would ever catch, and the single most damaging bug this codebase
     * could ship.
     */
    expect(await emailsVisibleTo(TENANT_A)).toHaveLength(2);

    const afterwards = await db.execute(sql`SELECT current_setting('app.tenant_id', true) AS t`);
    const leaked = [...afterwards][0]?.['t'];
    expect(leaked === null || leaked === '').toBe(true);

    // And the next scoped transaction sees its own tenant, not the last one.
    expect(await emailsVisibleTo(TENANT_B)).toEqual(['b1@example.com']);
  });

  it('refuses a write that would land in another tenant', async () => {
    // WITH CHECK, not just USING. Reading is only half of isolation: without
    // it, tenant A could insert a row owned by tenant B and then be unable to
    // see the row it had just created.
    await expect(
      withTenant(db, TENANT_A, async (tx) => {
        await tx.execute(
          sql`INSERT INTO person (tenant_id, work_email) VALUES (${TENANT_B}::uuid, 'smuggled@example.com')`,
        );
      }),
    ).rejects.toThrow();

    expect(await emailsVisibleTo(TENANT_B)).toEqual(['b1@example.com']);
  });

  it('does not turn the escape hatch into a way past the database', async () => {
    /*
     * `withoutTenantScope` reads as permission to see everything, and for a
     * migration running as an owning role it is. For a service role it is not:
     * it only declines to set the tenant, and the policy still applies. Worth
     * pinning, because the name invites the assumption that it disables RLS,
     * and a platform job written on that assumption would silently process
     * nothing rather than fail.
     */
    const rows = await withoutTenantScope(db, 'asserting the hatch is not a bypass', async (tx) =>
      tx.execute(sql`SELECT work_email FROM person`),
    );
    expect([...rows]).toHaveLength(0);
  });

  it('rolls the tenant scope back when the callback throws', async () => {
    await expect(
      withTenant(db, TENANT_A, async (tx) => {
        await tx.execute(
          sql`INSERT INTO person (tenant_id, work_email) VALUES (${TENANT_A}::uuid, 'rolled-back@example.com')`,
        );
        throw new Error('deliberate failure inside the transaction');
      }),
    ).rejects.toThrow('deliberate failure');

    expect(await emailsVisibleTo(TENANT_A)).toEqual(['a1@example.com', 'a2@example.com']);
  });
});
