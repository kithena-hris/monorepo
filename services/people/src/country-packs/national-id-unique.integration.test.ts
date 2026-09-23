import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { fixedClock } from '@kithena/domain-kit';
import { startPostgres } from '@kithena/testing';

import { inTenantResult, personAccess } from '../application/person/person-access.js';
import { publishSchema } from '../application/schema/publish-schema.js';
import { Person } from '../domain/person/person.js';
import { drizzlePersonRepository } from '../infrastructure/drizzle-person-repository.js';
import {
  drizzlePersonReader,
  drizzleRelations,
  drizzleSchemaVersions,
} from '../infrastructure/drizzle-person-reader.js';
import {
  drizzlePeopleFacts,
  drizzleSchemaRepository,
} from '../infrastructure/drizzle-schema-repository.js';
import { staticKeyRing } from '../infrastructure/envelope.js';
import { drizzleSecretStore } from '../infrastructure/secret-store.js';
import { claimRotation, drizzleUniqueClaims } from '../infrastructure/unique.js';
import { tenantTransaction } from '../infrastructure/unit-of-work.js';
import { COUNTRY_PACKS } from './packs.js';
import { seedCountryPack } from './seed.js';

/**
 * PEO-082 over the real tables: the country packs' national identifiers are
 * unique per tenant, a second person quoting one is refused however it is
 * spaced or cased, and nothing in the `people` schema holds one in plaintext.
 */

const ACME = '00000000-0000-4000-8000-00000000000a';
const ADA = '00000000-0000-4000-8000-0000000000a1';
const GRACE = '00000000-0000-4000-8000-0000000000a2';
const clock = fixedClock('2026-09-23T09:00:00.000Z');
const K1 = { id: 'k1', key: randomBytes(32) };
const K2 = { id: 'k2', key: randomBytes(32) };
const ring = staticKeyRing([K1]);

/**
 * The identifier, as Ada gives it and as Grace later types the same one. Not
 * the packs' own examples, which the schema holds in a description.
 */
const IDENTIFIERS = [
  { key: 'es_nif', value: '12345678Z', again: '12345678-z', plain: '12345678' },
  { key: 'gb_ni_number', value: 'JG103759A', again: 'jg 10 37 59 a', plain: '103759' },
  { key: 'in_pan', value: 'BNZPK4821L', again: 'bnzpk 4821 l', plain: 'BNZPK' },
  { key: 'us_ssn', value: '123-45-6789', again: '123456789', plain: '12345' },
] as const;

let stopPg: (() => Promise<void>) | undefined;
let adminClient: ReturnType<typeof postgres> | undefined;
let serviceClient: ReturnType<typeof postgres> | undefined;
let admin: PostgresJsDatabase;
let inTenant: ReturnType<typeof tenantTransaction>;

let ids = 0;
const newId = () => `01890000-0000-7000-8000-${String((ids += 1)).padStart(12, '0')}`;
const people = personAccess({
  people: drizzlePersonRepository(),
  reader: drizzlePersonReader(),
  schemas: drizzleSchemaVersions(),
  relations: drizzleRelations(),
  secrets: drizzleSecretStore(ring),
  uniques: drizzleUniqueClaims(ring),
  clock,
  newId,
});

const hr = { accountId: '00000000-0000-4000-8000-0000000000ff', roles: new Set(['hr']) };
const write = (personId: string, changes: Record<string, unknown>) =>
  inTenantResult(inTenant, ACME, (tx) =>
    people.update(tx, {
      tenantId: ACME,
      viewer: hr,
      correlationId: '00000000-0000-4000-8000-0000000000c1',
      personId,
      changes,
    }),
  );

const migration = (file: string): Promise<string> =>
  readFile(new URL(`../../../../migrations/${file}`, import.meta.url), 'utf8');

/** Every value in every table in the `people` schema, as one string, as the retention test dumps it. */
async function everythingStored(): Promise<string> {
  const tables = await admin.execute(sql`
    SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'people' AND table_type = 'BASE TABLE'
  `);
  const dumps: string[] = [];
  for (const table of tables) {
    // eslint-disable-next-line no-await-in-loop -- a handful of tables, in a test
    const rows = await admin.execute(sql.raw(`SELECT * FROM people.${String(table['table_name'])}`));
    dumps.push(JSON.stringify([...rows]));
  }
  return dumps.join('\n');
}

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
    '20260923110000_people_completeness.sql',
    '20260924110000_people_unique_hash.sql',
  ]) {
    await admin.execute(sql.raw(await migration(file)));
  }
  await admin.execute(sql`ALTER ROLE svc_people LOGIN PASSWORD 'svc_people'`);
  const asService = new URL(pg.url);
  asService.username = 'svc_people';
  asService.password = 'svc_people';
  serviceClient = postgres(asService.toString(), { max: 4 });
  inTenant = tenantTransaction(drizzle(serviceClient));

  await inTenant(ACME, async ({ tx }) => {
    for (const country of ['ES', 'GB', 'IN', 'US'] as const) {
      // eslint-disable-next-line no-await-in-loop -- four packs, one transaction
      expect((await seedCountryPack(tx, ACME, COUNTRY_PACKS[country])).ok).toBe(true);
    }
  });
  const published = await inTenant(ACME, ({ tx }) =>
    publishSchema({
      schema: drizzleSchemaRepository(),
      people: drizzlePeopleFacts(),
      clock,
      newEventId: newId,
    }).publish(tx, {
      tenantId: ACME,
      actor: { kind: 'system', process: 'country-pack' },
      publishedBy: null,
      correlationId: '00000000-0000-4000-8000-0000000000c1',
      artifactUrl: 'https://api.kithena.test/v1/people/schema/1',
    }),
  );
  expect(published.ok).toBe(true);

  for (const id of [ADA, GRACE]) {
    // eslint-disable-next-line no-await-in-loop -- two people, in a test
    await inTenant(ACME, ({ tx }) =>
      drizzlePersonRepository().create(
        tx,
        Person.rehydrate({
          id,
          tenantId: ACME,
          status: 'active',
          identityAccountId: null,
          hireDate: '2026-01-01',
          lastWorkingDay: null,
        }),
        {},
      ),
    );
  }
});

afterAll(async () => {
  await serviceClient?.end();
  await adminClient?.end();
  await stopPg?.();
});

describe('a national identifier from a country pack', () => {
  it.each(IDENTIFIERS)('$key is refused to a second person, however it is spaced or cased', async (id) => {
    expect((await write(ADA, { [id.key]: id.value })).ok).toBe(true);

    for (const spelling of [id.value, id.again]) {
      // eslint-disable-next-line no-await-in-loop -- two spellings
      const second = await write(GRACE, { [id.key]: spelling });
      expect(second.ok).toBe(false);
      if (second.ok) return;
      expect(second.error.code).toBe('UNIQUE_VALUE_TAKEN');
    }
  });

  it('is nowhere in the people schema in plaintext, in either spelling', async () => {
    const everything = (await everythingStored()).toUpperCase();
    for (const id of IDENTIFIERS) {
      for (const text of [id.value, id.again, id.plain]) {
        expect(everything).not.toContain(text.toUpperCase());
      }
    }
    const claims = await admin.execute(sql`
      SELECT count(*)::int AS n FROM people.attribute_unique
       WHERE normalised_value IS NULL AND octet_length(value_hash) = 32
    `);
    expect(Number([...claims][0]?.['n'])).toBe(IDENTIFIERS.length);
  });

  it('is released when the holder changes it, and free for the next person', async () => {
    // 87654321X: 87654321 mod 23 is 10, and the tenth control letter is X.
    expect((await write(ADA, { es_nif: '87654321X' })).ok).toBe(true);
    expect((await write(GRACE, { es_nif: '12345678 Z' })).ok).toBe(true);
    expect((await write(ADA, { es_nif: '12345678z' })).ok).toBe(false);
  });

  it('stays unique through a rotation that reads each value back from the vault', async () => {
    // `PEOPLE_SECRET_KEYS` after the rollout's second step: k2 current, k1 still held.
    const keys = [K2, K1].map((k) => `${k.id}:${k.key.toString('base64')}`).join(',');
    await claimRotation(inTenant, keys)(ACME);

    const rows = await admin.execute(sql`SELECT DISTINCT key_id FROM people.attribute_unique`);
    expect([...rows].map((r) => r['key_id'])).toEqual(['k2']);

    // k1 dropped: the re-keyed claims are still found, in either spelling.
    const after = personAccess({
      people: drizzlePersonRepository(),
      reader: drizzlePersonReader(),
      schemas: drizzleSchemaVersions(),
      relations: drizzleRelations(),
      secrets: drizzleSecretStore(staticKeyRing([K2, K1])),
      uniques: drizzleUniqueClaims(staticKeyRing([K2])),
      clock,
      newId,
    });
    const taken = await inTenantResult(inTenant, ACME, (tx) =>
      after.update(tx, {
        tenantId: ACME,
        viewer: hr,
        correlationId: '00000000-0000-4000-8000-0000000000c1',
        personId: GRACE,
        changes: { gb_ni_number: 'JG 103759 a' },
      }),
    );
    expect(!taken.ok && taken.error.code).toBe('UNIQUE_VALUE_TAKEN');
  });
});
