import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fixedClock } from '@kithena/domain-kit';
import { startPostgres } from '@kithena/testing';

import { Person } from '../../domain/person/person.js';
import { drizzlePersonRepository } from '../../infrastructure/drizzle-person-repository.js';
import {
  drizzlePersonReader,
  drizzleRelations,
  drizzleSchemaVersions,
} from '../../infrastructure/drizzle-person-reader.js';
import { drizzleSchemaRepository } from '../../infrastructure/drizzle-schema-repository.js';
import { staticKeyRing } from '../../infrastructure/envelope.js';
import { drizzleSecretStore } from '../../infrastructure/secret-store.js';
import { drizzleUniqueClaims } from '../../infrastructure/unique.js';
import { tenantTransaction } from '../../infrastructure/unit-of-work.js';
import { versionOf } from '../person/in-memory.js';
import { inTenantResult, personAccess, type PersonAccessDeps } from '../person/person-access.js';
import { commitImport, type CommitDeps } from './commit.js';
import { asking, attributes, csv, HEADERS, priyasRows } from './fixture.js';
import { drizzleImportLedger, drizzleRowScope } from './ledger.js';
import { proposeMapping, resolveMapping } from './mapping.js';
import { parseUpload } from './parse.js';

/**
 * PEO-041 over Postgres, as `svc_people`: the checksum constraint, the
 * savepoint per row, and the outbox — the three things memory cannot prove.
 */

const TENANT = asking.tenantId;
const HOLDER = '00000000-0000-4000-8000-0000000000d1';
const HR_RELATIONS = {
  isSelf: false,
  isManager: false,
  isInManagerChain: false,
  isHr: true,
  isFinance: false,
  isAdmin: false,
};

let stopPg: (() => Promise<void>) | undefined;
const clients: ReturnType<typeof postgres>[] = [];
let admin: ReturnType<typeof drizzle>;
let inTenant: ReturnType<typeof tenantTransaction>;

const personDeps: PersonAccessDeps = {
  people: drizzlePersonRepository(),
  reader: drizzlePersonReader(),
  schemas: drizzleSchemaVersions(),
  relations: drizzleRelations(),
  secrets: drizzleSecretStore(staticKeyRing([{ id: 'k1', key: randomBytes(32) }])),
  uniques: drizzleUniqueClaims(),
  clock: fixedClock('2026-09-22T09:00:00.000Z'),
  newId: randomUUID,
};
const deps: CommitDeps = {
  access: personAccess(personDeps),
  schemas: personDeps.schemas,
  relations: personDeps.relations,
  people: personDeps.people,
  clock: personDeps.clock,
  newId: randomUUID,
  ledger: drizzleImportLedger(),
  rowScope: drizzleRowScope,
};

const migration = (file: string): Promise<string> =>
  readFile(new URL(`../../../../../migrations/${file}`, import.meta.url), 'utf8');

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
    '20260922170000_people_person.sql',
    '20260923110000_people_completeness.sql',
    '20260923130000_people_import_export.sql',
  ]) {
    await admin.execute(sql.raw(await migration(file)));
  }
  await admin.execute(sql`ALTER ROLE svc_people LOGIN PASSWORD 'svc_people'`);
  const asService = new URL(pg.url);
  asService.username = 'svc_people';
  asService.password = 'svc_people';
  const serviceClient = postgres(asService.toString(), { max: 4 });
  clients.push(serviceClient);
  inTenant = tenantTransaction(drizzle(serviceClient));

  await inTenant(TENANT, async ({ tx }) => {
    await drizzleSchemaRepository().appendVersion(tx, TENANT, versionOf(1, attributes), [], '2026-09-01');
    // Somebody already holding c61@acme.test, whom the dry run cannot see as
    // holding it: the write path's claim is what finds out.
    await drizzlePersonRepository().create(
      tx,
      Person.rehydrate({
        id: HOLDER,
        tenantId: TENANT,
        status: 'active',
        identityAccountId: null,
        hireDate: '2026-01-01',
        lastWorkingDay: null,
      }),
    );
    await tx.execute(sql`
      INSERT INTO people.attribute_unique (tenant_id, attribute_key, scope_id, normalised_value, person_id)
      VALUES (${TENANT}::uuid, 'work_email', ${TENANT}::uuid, 'c61@acme.test', ${HOLDER}::uuid)`);
  });
}, 180_000);

afterAll(async () => {
  for (const c of clients) await c.end();
  await stopPg?.();
});

async function upload(bytes: Uint8Array) {
  const file = await parseUpload(bytes);
  if (!file.ok) throw new Error(file.error.message);
  const version = versionOf(1, attributes);
  const proposed = await proposeMapping({
    file: file.value,
    version,
    relations: HR_RELATIONS,
    advisor: null,
  });
  const mapping = resolveMapping(proposed, {}, version, HR_RELATIONS);
  if (!mapping.ok) throw new Error(mapping.error.message);
  return inTenantResult(inTenant, TENANT, (tx) =>
    commitImport(tx, deps, { ...asking, file: file.value, mapping: mapping.value }),
  );
}

const count = async (query: ReturnType<typeof sql>) =>
  Number([...(await admin.execute<{ n: string }>(query))][0]?.n);

describe('an import over Postgres', () => {
  // The first ten new hires, and one row with no work email.
  const bytes = csv(HEADERS, [...priyasRows().slice(61, 71), priyasRows()[389 + 4] ?? []]);

  it('writes each row in its own savepoint: the one refused leaves nothing behind', async () => {
    const people = await count(sql`SELECT count(*) AS n FROM people.person`);
    const result = await upload(bytes);
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== 'imported') return;
    expect(result.value.counts).toMatchObject({ created: 9, blocked: 2 });
    // Nine people, and no provisional orphan from the row whose claim failed.
    expect(await count(sql`SELECT count(*) AS n FROM people.person`)).toBe(people + 9);
    expect(new TextDecoder().decode(result.value.report)).toContain('work_email is already in use');
  });

  it('the same file twice creates one set of people, even uploaded twice at once', async () => {
    const people = await count(sql`SELECT count(*) AS n FROM people.person`);
    const again = await upload(bytes);
    expect(again.ok && again.value.status).toBe('already_imported');

    const fresh = csv(HEADERS, priyasRows().slice(100, 105));
    const racing = await Promise.all([upload(fresh), upload(fresh)]);
    expect(racing.map((r) => r.ok && r.value.status).toSorted()).toEqual([
      'already_imported',
      'imported',
    ]);

    expect(await count(sql`SELECT count(*) AS n FROM people.person`)).toBe(people + 5);
    expect(await count(sql`SELECT count(*) AS n FROM people.import`)).toBe(2);
    expect(
      await count(
        sql`SELECT count(*) AS n FROM people.outbox WHERE event_name = 'people.import.completed'`,
      ),
    ).toBe(2);
  });

  it('keeps one tenant’s ledger from another', async () => {
    const other = '00000000-0000-4000-8000-00000000000b';
    const seen = await inTenant(other, ({ tx }) => tx.execute(sql`SELECT id FROM people.import`));
    expect([...seen]).toHaveLength(0);
  });
});
