import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { readFile } from 'node:fs/promises';
import { getTableColumns } from 'drizzle-orm';
import { outboxTable, publish } from '@kithena/db-kit';
import { CalendarDate, Instant, TenantId } from '@kithena/contracts';
import { startPostgres } from '@kithena/testing';

/**
 * The person tables, against a real database.
 *
 * Three claims, and each of them is a property of the schema rather than of
 * any query anybody writes. **Every table isolates its tenant.** **History is
 * append-only** — the correction mechanism rests on it, and a typo that could
 * be edited away is a pay cut followed by a raise in somebody's payroll run.
 * And **`people.person_secret` has no plaintext column**, asserted against the
 * catalogue rather than against a comment, because that is the one claim a
 * later migration could quietly break.
 */

const ACME = '00000000-0000-4000-8000-00000000000a';
const GLOBEX = '00000000-0000-4000-8000-00000000000b';
const ADA = '00000000-0000-4000-8000-0000000000a1';
const GRACE = '00000000-0000-4000-8000-0000000000a2';

let stopPg: (() => Promise<void>) | undefined;
let adminClient: ReturnType<typeof postgres> | undefined;
let serviceClient: ReturnType<typeof postgres> | undefined;
let admin: PostgresJsDatabase;
let asPeople: PostgresJsDatabase;

const migration = (file: string): Promise<string> =>
  readFile(new URL(`../../../../migrations/${file}`, import.meta.url), 'utf8');

/** Every table this migration adds, so the isolation check cannot miss one. */
const TENANT_SCOPED = [
  'person',
  'person_attribute_history',
  'person_secret',
  'attribute_unique',
  'outbox',
] as const;

beforeAll(async () => {
  const pg = await startPostgres();
  stopPg = pg.stop;

  adminClient = postgres(pg.url, { max: 1 });
  admin = drizzle(adminClient);

  for (const file of [
    '20260821120000_tenant_registry.sql',
    '20260922140000_people_bootstrap.sql',
    '20260922160000_people_registry.sql',
    '20260926140000_people_visibility_rules.sql',
    '20260926180000_people_pending_change.sql',
    '20260922170000_people_person.sql',
    '20260924220000_people_access_end.sql',
    '20260926143000_people_duplicates.sql',
    '20260924220200_people_employment_period.sql',
    '20260924170000_people_calendar.sql',
    '20260924170100_people_tenant_company.sql',
    '20260924340000_people_person_key_lookup.sql',
    '20260926200000_people_status_idx_skip_scan.sql',
  ]) {
    await admin.execute(sql.raw(await migration(file)));
  }

  await admin.execute(sql`ALTER ROLE svc_people LOGIN PASSWORD 'svc_people'`);

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

beforeEach(async () => {
  await admin.execute(sql`DELETE FROM people.attribute_unique`);
  await admin.execute(sql`DELETE FROM people.person_secret`);
  await admin.execute(sql`ALTER TABLE people.person_attribute_history DISABLE TRIGGER history_is_append_only`);
  await admin.execute(sql`DELETE FROM people.person_attribute_history`);
  await admin.execute(sql`ALTER TABLE people.person_attribute_history ENABLE TRIGGER history_is_append_only`);
  await admin.execute(sql`DELETE FROM people.outbox`);
  await admin.execute(sql`UPDATE people.person SET manager_id = NULL`);
  await admin.execute(sql`DELETE FROM people.person`);
});

function inTenant<T>(tenantId: string, fn: (tx: PostgresJsDatabase) => Promise<T>): Promise<T> {
  return asPeople.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx);
  });
}

async function seedPerson(
  tenantId: string,
  id: string,
  over: { employeeNumber?: string | null; accountId?: string | null } = {},
): Promise<void> {
  await admin.execute(sql`
    INSERT INTO people.person (id, tenant_id, status, given_name, family_name, employee_number, identity_account_id)
    VALUES (${id}::uuid, ${tenantId}::uuid, 'active', 'Ada', 'Lovelace',
            ${over.employeeNumber ?? null}, ${over.accountId ?? null}::uuid)
  `);
}

describe('every table keeps its tenant to itself', () => {
  beforeEach(async () => {
    await seedPerson(ACME, ADA);
    await seedPerson(GLOBEX, GRACE);
  });

  it('has row level security forced on all five', async () => {
    // FORCE as well as ENABLE, because a table's owner bypasses its own
    // policies otherwise and the owner is what runs the migrations.
    const rows = await admin.execute(sql`
      SELECT relname, relrowsecurity, relforcerowsecurity
        FROM pg_class
       WHERE relnamespace = 'people'::regnamespace
         AND relname = ANY(${sql.raw(`'{${TENANT_SCOPED.join(',')}}'`)}::text[])
       ORDER BY relname
    `);

    expect([...rows]).toHaveLength(TENANT_SCOPED.length);
    for (const row of rows) {
      expect(row['relrowsecurity'], String(row['relname'])).toBe(true);
      expect(row['relforcerowsecurity'], String(row['relname'])).toBe(true);
    }
  });

  it('shows one tenant only their own people', async () => {
    const acme = await inTenant(ACME, async (tx) => [
      ...(await tx.execute(sql`SELECT id FROM people.person`)),
    ]);
    expect(acme.map((r) => r['id'])).toEqual([ADA]);
  });

  it('shows nothing at all to a connection with no tenant set', async () => {
    const rows = await asPeople.execute(sql`SELECT id FROM people.person`);
    expect([...rows]).toEqual([]);
  });

  it('refuses a write into another tenant', async () => {
    await expect(
      inTenant(ACME, (tx) =>
        tx.execute(sql`
          INSERT INTO people.person (tenant_id, status) VALUES (${GLOBEX}::uuid, 'provisional')
        `),
      ),
    ).rejects.toThrow();
  });

  it('refuses an outbox row written for somebody else', async () => {
    await expect(
      inTenant(ACME, (tx) =>
        tx.execute(sql`
          INSERT INTO people.outbox (event_id, tenant_id, event_name, event_version,
                                     aggregate_type, aggregate_id, partition_key, envelope)
          VALUES (gen_random_uuid(), ${GLOBEX}::uuid, 'people.person.hired', '1',
                  'Person', ${GRACE}, ${`${GLOBEX}:${GRACE}`}, '{}'::jsonb)
        `),
      ),
    ).rejects.toThrow();
  });
});

describe('the person row', () => {
  it('refuses a manager from another tenant', async () => {
    // The foreign key is composite for exactly this: an org chart that crossed
    // a tenant boundary is one customer's employee reporting to another's.
    await seedPerson(ACME, ADA);
    await seedPerson(GLOBEX, GRACE);
    await expect(
      admin.execute(sql`UPDATE people.person SET manager_id = ${GRACE}::uuid WHERE id = ${ADA}::uuid`),
    ).rejects.toThrow();
  });

  it('refuses somebody managing themselves', async () => {
    await seedPerson(ACME, ADA);
    await expect(
      admin.execute(sql`UPDATE people.person SET manager_id = ${ADA}::uuid WHERE id = ${ADA}::uuid`),
    ).rejects.toThrow();
  });

  it('refuses a last working day before the hire date', async () => {
    await seedPerson(ACME, ADA);
    await expect(
      admin.execute(sql`
        UPDATE people.person SET hire_date = '2026-06-01', last_working_day = '2026-01-01'
         WHERE id = ${ADA}::uuid
      `),
    ).rejects.toThrow();
  });

  it('refuses an amount with no currency', async () => {
    // A number nobody can add up. The reverse — a currency with no amount — is
    // a setting pretending to be a salary.
    await seedPerson(ACME, ADA);
    await expect(
      admin.execute(sql`UPDATE people.person SET base_salary = 55000 WHERE id = ${ADA}::uuid`),
    ).rejects.toThrow();
  });

  it('keeps money exact rather than approximate', async () => {
    await seedPerson(ACME, ADA);
    await admin.execute(sql`
      UPDATE people.person SET base_salary = 55000.1234, salary_currency = 'EUR'
       WHERE id = ${ADA}::uuid
    `);
    const rows = await admin.execute(sql`SELECT base_salary FROM people.person WHERE id = ${ADA}::uuid`);
    expect(String([...rows][0]?.['base_salary'])).toBe('55000.1234');
  });

  it('allows one person per identity account and no more', async () => {
    // What makes the provisioning consumer idempotent: the index, not the
    // consumer remembering to check first.
    const account = '00000000-0000-4000-8000-0000000000b1';
    await seedPerson(ACME, ADA, { accountId: account });
    await expect(seedPerson(ACME, GRACE, { accountId: account })).rejects.toThrow();
  });

  it('allows two people with no account at all', async () => {
    // An import of four hundred people creates four hundred rows and no
    // logins. A unique index over a nullable column would refuse the second.
    await seedPerson(ACME, ADA);
    await seedPerson(ACME, GRACE);
    const rows = await admin.execute(sql`SELECT count(*)::int AS n FROM people.person`);
    expect(Number([...rows][0]?.['n'])).toBe(2);
  });

  it('refuses a duplicate employee number within a tenant', async () => {
    await seedPerson(ACME, ADA, { employeeNumber: 'E-1' });
    await expect(seedPerson(ACME, GRACE, { employeeNumber: 'E-1' })).rejects.toThrow();
  });

  it('lets two tenants use the same employee number', async () => {
    await seedPerson(ACME, ADA, { employeeNumber: 'E-1' });
    await seedPerson(GLOBEX, GRACE, { employeeNumber: 'E-1' });
    const rows = await admin.execute(sql`
      SELECT count(*)::int AS n FROM people.person WHERE employee_number = 'E-1'
    `);
    expect(Number([...rows][0]?.['n'])).toBe(2);
  });

  it('refuses a custom bag that is not an object', async () => {
    await seedPerson(ACME, ADA);
    await expect(
      admin.execute(sql`UPDATE people.person SET custom = '[]'::jsonb WHERE id = ${ADA}::uuid`),
    ).rejects.toThrow();
  });
});

/** Index names in a plan, however deep. */
function indexesIn(node: unknown): string[] {
  if (typeof node !== 'object' || node === null) return [];
  const own = (node as Record<string, unknown>)['Index Name'];
  return [...(typeof own === 'string' ? [own] : []), ...Object.values(node).flatMap(indexesIn)];
}

/** The indexes Postgres would read to answer a query. */
async function plan(query: ReturnType<typeof sql>): Promise<string[]> {
  const [row] = await admin.execute<{ 'QUERY PLAN': unknown }>(
    sql`EXPLAIN (FORMAT JSON) ${query}`,
  );
  return indexesIn(row?.['QUERY PLAN']);
}

describe('a foreign key into people.person', () => {
  // Postgres's own check, verbatim but for the quoting: what every insert
  // into history, secrets, claims and gaps runs, and every manager set.
  const CHECK = sql`
    SELECT 1 FROM ONLY people.person x
     WHERE tenant_id OPERATOR(pg_catalog.=) $1 AND id OPERATOR(pg_catalog.=) $2
       FOR KEY SHARE OF x`;
  const UNSEEN = '00000000-0000-4000-8000-00000000000c';


  it('is checked by the key for a tenant the statistics have not seen', async () => {
    // One large tenant the statistics know, and one they do not: the first
    // import of a new tenant, whose rows are all in its open transaction.
    // Each nobody's manager, so the manager index is as short as it gets.
    await admin.execute(sql`BEGIN`);
    try {
      await admin.execute(sql`
        INSERT INTO people.person (id, tenant_id, status, given_name, family_name)
        SELECT gen_random_uuid(), ${ACME}::uuid, 'active', 'G' || g, 'F' || g
          FROM generate_series(1, 20000) g`);
      await admin.execute(sql`ANALYZE people.person`);
      await admin.execute(sql`PREPARE fk_check(uuid, uuid) AS ${CHECK}`);
      for (const mode of ['force_custom_plan', 'force_generic_plan']) {
        // eslint-disable-next-line no-await-in-loop -- one connection, one setting at a time
        await admin.execute(sql`SELECT set_config('plan_cache_mode', ${mode}, true)`);
        expect(
          // eslint-disable-next-line no-await-in-loop -- the plan under the setting just made
          await plan(sql.raw(`EXECUTE fk_check('${UNSEEN}', '${ADA}')`)),
          mode,
        ).toEqual([expect.stringMatching(/^person_(tenant_id_key|pkey)$/u)]);
      }
      // What the replaced indexes served still has an index to serve it.
      expect(
        await plan(sql`
          SELECT id FROM people.person WHERE tenant_id = ${UNSEEN}::uuid AND manager_id = ${ADA}::uuid`),
      ).toEqual(['person_reports_idx']);
      expect(
        await plan(sql`
          SELECT id FROM people.person
           WHERE tenant_id = ${ACME}::uuid AND status = 'pre_hire' AND hire_date <= DATE '2026-10-01'
           ORDER BY hire_date, id LIMIT 50`),
      ).toEqual(['person_status_idx']);
    } finally {
      await admin.execute(sql`ROLLBACK`);
      await admin.execute(sql`DEALLOCATE ALL`);
    }
  });
});

describe('history is append-only', () => {
  beforeEach(async () => {
    await seedPerson(ACME, ADA);
    await admin.execute(sql`
      INSERT INTO people.person_attribute_history
        (id, tenant_id, person_id, attribute_key, value, effective_from, actor)
      VALUES ('01890000-0000-7000-8000-000000000001'::uuid, ${ACME}::uuid, ${ADA}::uuid,
              'base_salary', '500000'::jsonb, '2026-01-01',
              ${JSON.stringify({ kind: 'system', process: 'test' })}::jsonb)
    `);
  });

  it('refuses an update, however well meant', async () => {
    // The whole correction mechanism rests on this. A typo edited away is a
    // pay cut followed by a raise the next time payroll reads the timeline.
    await expect(
      admin.execute(sql`UPDATE people.person_attribute_history SET value = '5000000'::jsonb`),
    ).rejects.toThrow();

    const rows = await admin.execute(sql`SELECT value FROM people.person_attribute_history`);
    expect(String([...rows][0]?.['value'])).toBe('500000');
  });

  it('refuses a delete', async () => {
    await expect(
      admin.execute(sql`DELETE FROM people.person_attribute_history`),
    ).rejects.toThrow();
  });

  it('takes a correction carrying supersedes', async () => {
    await admin.execute(sql`
      INSERT INTO people.person_attribute_history
        (id, tenant_id, person_id, attribute_key, value, effective_from, actor, supersedes)
      VALUES ('01890000-0000-7000-8000-000000000002'::uuid, ${ACME}::uuid, ${ADA}::uuid,
              'base_salary', '5000000'::jsonb, '2026-01-01',
              ${JSON.stringify({ kind: 'system', process: 'test' })}::jsonb,
              '01890000-0000-7000-8000-000000000001'::uuid)
    `);
    const rows = await admin.execute(sql`SELECT count(*)::int AS n FROM people.person_attribute_history`);
    expect(Number([...rows][0]?.['n'])).toBe(2);
  });

  it('refuses a second live correction of one fact', async () => {
    // Two would be two answers to "what was the salary in March". Correcting a
    // correction names the correction.
    const correction = (id: string) => admin.execute(sql`
      INSERT INTO people.person_attribute_history
        (id, tenant_id, person_id, attribute_key, value, effective_from, actor, supersedes)
      VALUES (${id}::uuid, ${ACME}::uuid, ${ADA}::uuid,
              'base_salary', '5000000'::jsonb, '2026-01-01',
              ${JSON.stringify({ kind: 'system', process: 'test' })}::jsonb,
              '01890000-0000-7000-8000-000000000001'::uuid)
    `);

    await correction('01890000-0000-7000-8000-000000000002');
    await expect(correction('01890000-0000-7000-8000-000000000003')).rejects.toThrow();
  });

  it('gives the service no way to revise one either', async () => {
    const grants = await admin.execute(sql`
      SELECT privilege_type FROM information_schema.role_table_grants
       WHERE grantee = 'svc_people' AND table_name = 'person_attribute_history'
       ORDER BY privilege_type
    `);
    expect([...grants].map((r) => r['privilege_type'])).toEqual(['INSERT', 'SELECT']);
  });
});

describe('the secret store', () => {
  it('has no plaintext column', async () => {
    // Asserted against the catalogue rather than against a comment, because
    // this is the claim a later migration could quietly break: one column
    // called `value` added in a hurry and the envelope encryption is
    // decoration.
    const rows = await admin.execute(sql`
      SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'people' AND table_name = 'person_secret'
       ORDER BY column_name
    `);

    expect([...rows].map((r) => r['column_name'])).toEqual([
      'attribute_key',
      'ciphertext',
      'created_at',
      'key_id',
      'last4',
      'person_id',
      'tenant_id',
      'updated_at',
    ]);
  });

  it('keeps the ciphertext as bytes rather than as text', async () => {
    const rows = await admin.execute(sql`
      SELECT data_type FROM information_schema.columns
       WHERE table_schema = 'people' AND table_name = 'person_secret'
         AND column_name = 'ciphertext'
    `);
    expect(String([...rows][0]?.['data_type'])).toBe('bytea');
  });

  it('refuses a last4 holding more than four characters', async () => {
    await seedPerson(ACME, ADA);
    await expect(
      admin.execute(sql`
        INSERT INTO people.person_secret (tenant_id, person_id, attribute_key, ciphertext, key_id, last4)
        VALUES (${ACME}::uuid, ${ADA}::uuid, 'bank_account', '\\x00'::bytea, 'k1', '12345678')
      `),
    ).rejects.toThrow();
  });

  it('holds one secret per person per attribute', async () => {
    await seedPerson(ACME, ADA);
    const insert = () => admin.execute(sql`
      INSERT INTO people.person_secret (tenant_id, person_id, attribute_key, ciphertext, key_id)
      VALUES (${ACME}::uuid, ${ADA}::uuid, 'bank_account', '\\x00'::bytea, 'k1')
    `);
    await insert();
    await expect(insert()).rejects.toThrow();
  });
});

describe('uniqueness on a tenant-defined attribute', () => {
  beforeEach(async () => {
    await seedPerson(ACME, ADA);
    await seedPerson(ACME, GRACE);
  });

  const claim = (personId: string, value: string) => admin.execute(sql`
    INSERT INTO people.attribute_unique (tenant_id, attribute_key, scope_id, normalised_value, person_id)
    VALUES (${ACME}::uuid, 'works_council_id', ${ACME}::uuid, ${value}, ${personId}::uuid)
  `);

  it('lets exactly one person hold a value', async () => {
    await claim(ADA, 'wc-1');
    await expect(claim(GRACE, 'wc-1')).rejects.toThrow();
  });

  it('is scoped, so the same value stands in two legal entities', async () => {
    await claim(ADA, 'wc-1');
    await admin.execute(sql`
      INSERT INTO people.attribute_unique (tenant_id, attribute_key, scope_id, normalised_value, person_id)
      VALUES (${ACME}::uuid, 'works_council_id', ${GLOBEX}::uuid, 'wc-1', ${GRACE}::uuid)
    `);
    const rows = await admin.execute(sql`SELECT count(*)::int AS n FROM people.attribute_unique`);
    expect(Number([...rows][0]?.['n'])).toBe(2);
  });

  it('releases every claim when a discarded record is deleted', async () => {
    // A discarded provisional record is the one state a hard delete may
    // follow, and its claims have to go with it or the value stays taken by
    // somebody who does not exist.
    await claim(ADA, 'wc-1');
    await admin.execute(sql`DELETE FROM people.person WHERE id = ${ADA}::uuid`);
    const rows = await admin.execute(sql`SELECT count(*)::int AS n FROM people.attribute_unique`);
    expect(Number([...rows][0]?.['n'])).toBe(0);
  });
});

describe('the outbox', () => {
  it('is the shape db-kit writes, column for column and type for type', async () => {
    /*
     * Compared against `outboxTable` rather than against `platform.outbox`.
     *
     * Both schemas implement one contract and `@kithena/db-kit` is where it
     * lives — `publish()` inserts exactly these columns, for identity,
     * messaging and People alike. Reading the platform table instead would
     * mean applying identity's migration here, which couples a People test to
     * another service's schema and fails this suite the day identity adds a
     * column of its own.
     *
     * Types as well as names, because the drift that matters is not a missing
     * column — `publish()` fails loudly on one of those. It is
     * `aggregate_id` declared `uuid` here and `text` in db-kit: every insert
     * still succeeds until the first aggregate whose id is not a uuid, and
     * every Debezium consumer downstream has by then been told the field is
     * a uuid.
     *
     * Drizzle's `getSQLType()` and `information_schema.data_type` agree on
     * spelling for every type this table uses, which is what lets the two be
     * compared directly rather than through a mapping nobody would maintain.
     */
    const expected = Object.values(getTableColumns(outboxTable('people')))
      .map((column) => `${column.name}:${column.getSQLType()}`)
      .toSorted();

    const rows = await admin.execute(sql`
      SELECT column_name, data_type FROM information_schema.columns
       WHERE table_schema = 'people' AND table_name = 'outbox'
       ORDER BY column_name
    `);

    expect([...rows].map((r) => `${String(r['column_name'])}:${String(r['data_type'])}`)).toEqual(
      expected,
    );
  });

  it('takes what publish() actually writes', async () => {
    // The column list above is a shape check; this is the one that proves the
    // types accept real values. `publish()` is db-kit's own insert path, run
    // against the table the migration created rather than against the DDL
    // db-kit's own suite hand-writes for itself.
    await seedPerson(ACME, ADA);

    await inTenant(ACME, (tx) =>
      publish(tx, outboxTable('people'), [
        {
          eventId: '01890000-0000-7000-8000-00000000000e',
          eventName: 'people.person.hired',
          eventVersion: 1,
          // Parsed rather than cast, for the reason db-kit's own suite gives:
          // the brands exist so a raw string cannot be mistaken for a
          // validated one, and a test reaching for `as` to get past them is
          // the first place that guarantee stops applying.
          tenantId: TenantId.parse(ACME),
          occurredAt: Instant.parse('2026-09-22T09:00:00.000Z'),
          effectiveFrom: CalendarDate.parse('2026-09-01'),
          aggregate: { type: 'Person', id: ADA, version: 1 },
          actor: { kind: 'system', process: 'integration-test' },
          correlationId: '00000000-0000-4000-8000-0000000000c1',
          causationId: null,
          payload: { personId: ADA },
        },
      ]),
    );

    const rows = await admin.execute(sql`SELECT event_name, envelope FROM people.outbox`);
    expect([...rows][0]).toMatchObject({ event_name: 'people.person.hired' });
  });

  it('partitions by tenant and aggregate, keeping one record\'s changes ordered', async () => {
    await seedPerson(ACME, ADA);
    await inTenant(ACME, (tx) =>
      tx.execute(sql`
        INSERT INTO people.outbox (event_id, tenant_id, event_name, event_version,
                                   aggregate_type, aggregate_id, partition_key, envelope)
        VALUES (gen_random_uuid(), ${ACME}::uuid, 'people.person.hired', '1',
                'Person', ${ADA}, ${`${ACME}:${ADA}`}, '{}'::jsonb)
      `),
    );

    const rows = await admin.execute(sql`SELECT partition_key FROM people.outbox`);
    expect(String([...rows][0]?.['partition_key'])).toBe(`${ACME}:${ADA}`);
  });
});
