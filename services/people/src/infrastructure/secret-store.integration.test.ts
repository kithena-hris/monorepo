import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { startPostgres } from '@kithena/testing';

import { staticKeyRing, type MasterKey } from './envelope.js';
import { drizzleSecretStore, secretRotation, type SecretLogger } from './secret-store.js';
import { tenantTransaction } from './unit-of-work.js';

/**
 * The secret store, against a real database.
 *
 * The ticket names one assertion and it is the whole file: **the plaintext
 * appears in no other table, no log line and no event payload.** A bank
 * account that leaked into `custom` would be in a JSONB column, a GIN index, a
 * replication slot and every fixture somebody built from a dump — and it would
 * have got there through a settings screen, not through a decision anybody
 * reviewed.
 *
 * So this sweeps the whole schema for the value rather than checking the
 * column it was supposed to avoid. A test that only looks where it expects to
 * find nothing is a test that passes the day somebody adds a column.
 */

const ACME = '00000000-0000-4000-8000-00000000000a';
const ADA = '00000000-0000-4000-8000-0000000000a1';
const IBAN = 'ES9121000418450200051332';
const NIF = '12345678Z';

const key = (id: string): MasterKey => ({ id, key: randomBytes(32) });

let stopPg: (() => Promise<void>) | undefined;
let adminClient: ReturnType<typeof postgres> | undefined;
let serviceClient: ReturnType<typeof postgres> | undefined;
let admin: PostgresJsDatabase;
let inTenant: ReturnType<typeof tenantTransaction>;

/** Everything this store was handed to write with. Read back and searched. */
const written: { fields: Record<string, unknown>; message: string }[] = [];
const logger: SecretLogger = {
  info: (fields, message) => {
    written.push({ fields, message });
  },
};

const ring = staticKeyRing([key('k1')]);
const store = drizzleSecretStore(ring, logger);

const migration = (file: string): Promise<string> =>
  readFile(new URL(`../../../../migrations/${file}`, import.meta.url), 'utf8');

beforeAll(async () => {
  const pg = await startPostgres();
  stopPg = pg.stop;

  adminClient = postgres(pg.url, { max: 1 });
  admin = drizzle(adminClient);

  for (const file of [
    '20260821120000_tenant_registry.sql',
    '20260922140000_people_bootstrap.sql',
    '20260922160000_people_registry.sql',
    '20260922170000_people_person.sql',
    '20260924220000_people_access_end.sql',
    '20260924220200_people_employment_period.sql',
    '20260924170000_people_calendar.sql',
    '20260924170100_people_tenant_company.sql',
  ]) {
    await admin.execute(sql.raw(await migration(file)));
  }

  await admin.execute(sql`ALTER ROLE svc_people LOGIN PASSWORD 'svc_people'`);

  const asService = new URL(pg.url);
  asService.username = 'svc_people';
  asService.password = 'svc_people';
  serviceClient = postgres(asService.toString(), { max: 4 });
  inTenant = tenantTransaction(drizzle(serviceClient));
});

afterAll(async () => {
  await serviceClient?.end();
  await adminClient?.end();
  await stopPg?.();
});

beforeEach(async () => {
  written.length = 0;
  await admin.execute(sql`DELETE FROM people.person_secret`);
  await admin.execute(sql`DELETE FROM people.person`);
  await admin.execute(sql`
    INSERT INTO people.person (id, tenant_id, status, given_name, family_name)
    VALUES (${ADA}::uuid, ${ACME}::uuid, 'active', 'Ada', 'Lovelace')
  `);
});

const at = (attributeKey: string) => ({ tenantId: ACME, personId: ADA, attributeKey });

/**
 * Every value in every table in the `people` schema, as one string.
 *
 * Built from the catalogue rather than from a list written here, so a table
 * added next month is swept without anybody remembering to add it.
 */
async function everythingStored(): Promise<string> {
  const tables = await admin.execute(sql`
    SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'people' AND table_type = 'BASE TABLE'
     ORDER BY table_name
  `);

  const dumps: string[] = [];
  for (const table of tables) {
    const name = String(table['table_name']);
    // eslint-disable-next-line no-await-in-loop -- a handful of tables, in a test
    const rows = await admin.execute(sql.raw(`SELECT * FROM people.${name}`));
    dumps.push(JSON.stringify([...rows]));
  }
  return dumps.join('\n');
}

describe('a stored secret', () => {
  it('is nowhere in the database as plaintext', async () => {
    await inTenant(ACME, ({ tx }) => store.put(tx, at('bank_account'), IBAN));

    const everything = everythingStored();
    await expect(everything).resolves.not.toContain(IBAN);
    // And not the distinctive tail of it either, which is what a grep for a
    // leak would actually match.
    await expect(everything).resolves.not.toContain('0200051332');
  });

  it('leaves nothing behind in the person row', async () => {
    // The specific failure this store exists to prevent: a bank account in
    // `custom`, which is JSONB, indexed, replicated and dumped into fixtures.
    await inTenant(ACME, ({ tx }) => store.put(tx, at('bank_account'), IBAN));

    const rows = await admin.execute(sql`SELECT custom FROM people.person WHERE id = ${ADA}::uuid`);
    expect(JSON.stringify([...rows][0]?.['custom'])).toBe('{}');
  });

  it('writes no event, because an encrypted value never travels on one', async () => {
    await inTenant(ACME, ({ tx }) => store.put(tx, at('bank_account'), IBAN));
    const rows = await admin.execute(sql`SELECT count(*)::int AS n FROM people.outbox`);
    expect(Number([...rows][0]?.['n'])).toBe(0);
  });

  it('never reaches a log line', async () => {
    await inTenant(ACME, ({ tx }) => store.put(tx, at('bank_account'), IBAN));
    await inTenant(ACME, ({ tx }) => store.reveal(tx, at('bank_account')));

    expect(written.length).toBeGreaterThan(0);
    const everythingLogged = JSON.stringify(written);
    expect(everythingLogged).not.toContain(IBAN);
    expect(everythingLogged).not.toContain('0200051332');
    // Not even the four digits a screen is allowed to show. A log aggregator
    // has its own retention and its own set of readers.
    expect(everythingLogged).not.toContain('1332');
  });

  it('keeps the ciphertext as bytes, not as a string that looks like one', async () => {
    await inTenant(ACME, ({ tx }) => store.put(tx, at('bank_account'), IBAN));
    const rows = await admin.execute(sql`
      SELECT pg_typeof(ciphertext)::text AS type FROM people.person_secret
    `);
    expect(String([...rows][0]?.['type'])).toBe('bytea');
  });
});

describe('reading one back', () => {
  beforeEach(async () => {
    await inTenant(ACME, ({ tx }) => store.put(tx, at('bank_account'), IBAN));
    await inTenant(ACME, ({ tx }) => store.put(tx, at('national_id'), NIF));
  });

  it('shows a screen the last four and nothing else', async () => {
    const listed = await inTenant(ACME, ({ tx }) => store.list(tx, ACME, ADA));
    expect(listed.map((s) => ({ key: s.attributeKey, last4: s.last4 })).toSorted((a, b) =>
      a.key.localeCompare(b.key),
    )).toEqual([
      { key: 'bank_account', last4: '1332' },
      { key: 'national_id', last4: '678Z' },
    ]);
  });

  it('returns the value only to the call named for it', async () => {
    const revealed = await inTenant(ACME, ({ tx }) => store.reveal(tx, at('bank_account')));
    expect(revealed).toBe(IBAN);
  });

  it('returns null for an attribute nobody stored', async () => {
    const revealed = await inTenant(ACME, ({ tx }) => store.reveal(tx, at('tax_id')));
    expect(revealed).toBeNull();
  });

  it('replaces a value rather than accumulating one row per edit', async () => {
    await inTenant(ACME, ({ tx }) => store.put(tx, at('bank_account'), 'ES7620770024003102575766'));

    const rows = await admin.execute(sql`
      SELECT count(*)::int AS n FROM people.person_secret WHERE attribute_key = 'bank_account'
    `);
    expect(Number([...rows][0]?.['n'])).toBe(1);

    const revealed = await inTenant(ACME, ({ tx }) => store.reveal(tx, at('bank_account')));
    expect(revealed).toBe('ES7620770024003102575766');
  });
});

describe('another tenant', () => {
  it('cannot read a secret through the store', async () => {
    await inTenant(ACME, ({ tx }) => store.put(tx, at('bank_account'), IBAN));

    const other = '00000000-0000-4000-8000-00000000000b';
    const revealed = await inTenant(other, ({ tx }) =>
      store.reveal(tx, { tenantId: other, personId: ADA, attributeKey: 'bank_account' }),
    );
    expect(revealed).toBeNull();
  });
});

describe('rotation', () => {
  it('re-wraps what is there and leaves the values readable', async () => {
    const older = key('k1');
    const newer = key('k2');

    const before = drizzleSecretStore(staticKeyRing([older]), logger);
    await inTenant(ACME, ({ tx }) => before.put(tx, at('bank_account'), IBAN));

    const after = drizzleSecretStore(staticKeyRing([newer, older]), logger);
    const count = await inTenant(ACME, ({ tx }) => after.rotate(tx, ACME, ADA));

    expect(count).toBe(1);
    const rows = await admin.execute(sql`SELECT key_id FROM people.person_secret`);
    expect(String([...rows][0]?.['key_id'])).toBe('k2');

    const revealed = await inTenant(ACME, ({ tx }) => after.reveal(tx, at('bank_account')));
    expect(revealed).toBe(IBAN);
  });

  it('does nothing when everything is already current', async () => {
    await inTenant(ACME, ({ tx }) => store.put(tx, at('bank_account'), IBAN));
    const count = await inTenant(ACME, ({ tx }) => store.rotate(tx, ACME, ADA));
    expect(count).toBe(0);
  });
});

describe('the rotation job (PEO-105)', () => {
  const env = (...keys: MasterKey[]) =>
    keys.map((k) => `${k.id}:${k.key.toString('base64')}`).join(',');
  const PEOPLE = Array.from(
    { length: 5 },
    (_, i) => `00000000-0000-4000-8000-0000000001${String(i).padStart(2, '0')}`,
  );

  it('re-wraps every secret in batches; with the old key dropped, every one still reveals', async () => {
    const older = key('k1');
    const newer = key('k2');
    for (const id of PEOPLE) {
      await admin.execute(sql`
        INSERT INTO people.person (id, tenant_id, status) VALUES (${id}::uuid, ${ACME}::uuid, 'active')`);
    }
    const before = drizzleSecretStore(staticKeyRing([older]));
    const values = new Map<string, string>();
    await inTenant(ACME, async ({ tx }) => {
      for (const [i, personId] of [ADA, ...PEOPLE].entries()) {
        for (const attributeKey of ['bank_account', 'national_id']) {
          const value = `${attributeKey}-${String(i)}-${randomBytes(4).toString('hex')}`;
          values.set(`${personId}:${attributeKey}`, value);
          await before.put(tx, { tenantId: ACME, personId, attributeKey }, value);
        }
      }
    });

    // Step 2 of the rollout: the new key current, the old one still held.
    // Batches of two people, so six people cross three batch boundaries.
    const rotate = secretRotation(inTenant, env(newer, older), { batch: 2 });
    expect(await rotate(ACME)).toEqual({ rewrapped: 12 });
    expect(await rotate(ACME)).toEqual({ rewrapped: 0 });
    const keys = await admin.execute(sql`SELECT DISTINCT key_id FROM people.person_secret`);
    expect([...keys].map((r) => String(r['key_id']))).toEqual(['k2']);

    // Step 4: the old key gone. Everything opens under the new one alone.
    const onlyNew = drizzleSecretStore(staticKeyRing([newer]));
    for (const [where, value] of values) {
      const [personId = '', attributeKey = ''] = where.split(':');
      const revealed = await inTenant(ACME, ({ tx }) =>
        onlyNew.reveal(tx, { tenantId: ACME, personId, attributeKey }),
      );
      expect(revealed).toBe(value);
    }
  });

  it('refuses, and touches nothing, when a secret sits under a key the ring does not hold', async () => {
    const lost = key('k0');
    await inTenant(ACME, ({ tx }) =>
      drizzleSecretStore(staticKeyRing([lost])).put(tx, at('bank_account'), IBAN),
    );
    const rotate = secretRotation(inTenant, env(key('k2'), key('k1')));
    expect(await rotate(ACME)).toEqual({ rewrapped: 0 });
    const keys = await admin.execute(sql`SELECT key_id FROM people.person_secret`);
    expect([...keys].map((r) => String(r['key_id']))).toEqual(['k0']);
  });

  it('is a no-op without keys', async () => {
    expect(await secretRotation(inTenant, undefined)(ACME)).toEqual({ rewrapped: 0 });
  });
});
