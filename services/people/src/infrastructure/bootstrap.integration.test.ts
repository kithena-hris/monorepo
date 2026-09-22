import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { readFile } from 'node:fs/promises';
import { startPostgres } from '@kithena/testing';

/**
 * The schema bootstrap, and the isolation pattern every later table copies.
 *
 * Two claims are made by `20260922140000_people_bootstrap.sql` and neither can
 * be checked against a fake. The first is that `svc_people` is `NOBYPASSRLS`:
 * a role that quietly carries BYPASSRLS passes every unit test ever written
 * and reads every customer's employee records in production, and Neon's
 * default owner carries it. The second is that the policy form in the
 * migration's comment actually refuses an unscoped connection rather than
 * raising 22P02 from an empty-string cast, which would turn "no tenant set"
 * into a 500 that reads like a bug somewhere else.
 *
 * The probe table is created here rather than shipped by the migration because
 * the bootstrap deliberately holds no data. What is under test is the pattern,
 * so the test writes the pattern out exactly as a later migration would — and
 * fails if copying it faithfully is not enough to isolate a tenant.
 */

const TENANT_A = '00000000-0000-4000-8000-00000000000a';
const TENANT_B = '00000000-0000-4000-8000-00000000000b';

let stopPg: (() => Promise<void>) | undefined;
let adminClient: ReturnType<typeof postgres> | undefined;
let serviceClient: ReturnType<typeof postgres> | undefined;
let admin: PostgresJsDatabase;
let asPeople: PostgresJsDatabase;

const migration = async (file: string): Promise<string> =>
  readFile(new URL(`../../../../migrations/${file}`, import.meta.url), 'utf8');

beforeAll(async () => {
  const pg = await startPostgres();
  stopPg = pg.stop;

  adminClient = postgres(pg.url, { max: 1 });
  admin = drizzle(adminClient);

  // The bootstrap alone. Nothing here depends on the identity migrations, and
  // a suite that applied them anyway would stop saying whether this file is
  // self-sufficient — which is the property that decides whether a deploy
  // against a fresh database survives it.
  await admin.execute(sql.raw(await migration('20260922140000_people_bootstrap.sql')));

  // The migration creates the role NOLOGIN and no password, because a password
  // in a committed file is a credential in the repository. The operator grants
  // both out of band; locally that is `tools/scripts/init-db.sql`, and here it
  // is this.
  await admin.execute(sql`ALTER ROLE svc_people LOGIN PASSWORD 'svc_people'`);

  // The probe, written the way the pattern in the migration says to write it.
  await admin.execute(sql`
    CREATE TABLE people.probe (
      id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL,
      note      text NOT NULL
    )
  `);
  await admin.execute(sql`ALTER TABLE people.probe ENABLE ROW LEVEL SECURITY`);
  await admin.execute(sql`ALTER TABLE people.probe FORCE  ROW LEVEL SECURITY`);
  await admin.execute(sql`
    CREATE POLICY probe_tenant_isolation ON people.probe
      USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  `);
  await admin.execute(sql`GRANT SELECT, INSERT ON people.probe TO svc_people`);

  await admin.execute(sql`
    INSERT INTO people.probe (tenant_id, note) VALUES
      (${TENANT_A}::uuid, 'acme'),
      (${TENANT_B}::uuid, 'globex')
  `);

  const asService = new URL(pg.url);
  asService.username = 'svc_people';
  asService.password = 'svc_people';
  serviceClient = postgres(asService.toString(), { max: 4 });
  asPeople = drizzle(serviceClient);
});

afterAll(async () => {
  await serviceClient?.end();
  await adminClient?.end();
  await stopPg?.();
});

function inTenant<T>(tenantId: string, fn: (tx: PostgresJsDatabase) => Promise<T>): Promise<T> {
  return asPeople.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx);
  });
}

async function notesVisible(tx: PostgresJsDatabase): Promise<string[]> {
  const rows = await tx.execute(sql`SELECT note FROM people.probe ORDER BY note`);
  return [...rows].map((row) => String(row['note']));
}

describe('the people schema bootstrap', () => {
  it('applies twice without complaint', async () => {
    // Expand-contract has no down migrations, so a re-run is what a retried
    // deploy does. `CREATE SCHEMA IF NOT EXISTS` and the role's existence
    // check are the whole reason this passes.
    await expect(
      admin.execute(sql.raw(await migration('20260922140000_people_bootstrap.sql'))),
    ).resolves.toBeDefined();
  });

  it('creates svc_people without the one attribute that would defeat every policy', async () => {
    const rows = await admin.execute(
      sql`SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = 'svc_people'`,
    );
    expect([...rows][0]).toMatchObject({ rolbypassrls: false, rolsuper: false });
  });

  it('reaches its own schema and no other', async () => {
    // A stand-in for `platform` and `timeoff`, created here because this suite
    // applies the People bootstrap and nothing else — which is the property
    // worth keeping. The claim under test is that the grant in the migration
    // names one schema, so a neighbouring schema is the thing to ask about.
    await admin.execute(sql`CREATE SCHEMA IF NOT EXISTS somebody_else`);

    const rows = await admin.execute(sql`
      SELECT has_schema_privilege('svc_people', 'people', 'USAGE')         AS own,
             has_schema_privilege('svc_people', 'somebody_else', 'USAGE')  AS neighbour
    `);
    expect([...rows][0]).toMatchObject({ own: true, neighbour: false });
  });
});

describe('a connection with no tenant set', () => {
  it('sees nothing, rather than raising', async () => {
    // The NULLIF is what makes this a quiet empty result. Without it the
    // empty string `set_config(..., true)` leaves behind is cast to uuid and
    // raises 22P02, so an unscoped query fails as a 500 that points at the
    // cast instead of at the missing tenant.
    const rows = await asPeople.execute(sql`SELECT note FROM people.probe`);
    expect([...rows]).toEqual([]);
  });

  it('sees nothing after a scoped transaction has ended', async () => {
    // `set_config(..., true)` is transaction-scoped and returns to the empty
    // string rather than to unset. A connection handed back to the pool must
    // not keep the last tenant it was used for.
    await inTenant(TENANT_A, async (tx) => notesVisible(tx));
    const rows = await asPeople.execute(sql`SELECT note FROM people.probe`);
    expect([...rows]).toEqual([]);
  });
});

describe('a connection scoped to one tenant', () => {
  it('sees its own rows and none of the other tenant\'s', async () => {
    expect(await inTenant(TENANT_A, notesVisible)).toEqual(['acme']);
    expect(await inTenant(TENANT_B, notesVisible)).toEqual(['globex']);
  });

  it('cannot write a row belonging to somebody else', async () => {
    // WITH CHECK, not just USING. Without it a caller inserts a row it then
    // cannot see — and the row it wrote belongs to a tenant it does not.
    await expect(
      inTenant(TENANT_A, (tx) =>
        tx.execute(sql`
          INSERT INTO people.probe (tenant_id, note) VALUES (${TENANT_B}::uuid, 'smuggled')
        `),
      ),
    ).rejects.toThrow();

    expect(await inTenant(TENANT_B, notesVisible)).toEqual(['globex']);
  });
});
