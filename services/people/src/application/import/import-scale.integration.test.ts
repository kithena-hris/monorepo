import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
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
import { define, versionOf } from '../person/in-memory.js';
import { inTenantResult, personAccess, type PersonAccessDeps } from '../person/person-access.js';
import { utcCalendars } from '../org/org.js';
import { localObjectStore } from '../export/object-store.js';
import { commitImport, type CommitDeps } from './commit.js';
import { asking, attributes, csv } from './fixture.js';
import { drizzleImportLedger, drizzleReportIndex, drizzleRowScope } from './ledger.js';
import { proposeMapping, resolveMapping } from './mapping.js';
import { parseUpload } from './parse.js';

/**
 * A new tenant's first import, at a size that shows how it grows.
 *
 * Each row writes a person, their history, their claims and their gaps, and
 * every one of those rows is checked by a foreign key into `people.person`:
 * `SELECT 1 … WHERE tenant_id = $1 AND id = $2`. The statistics cannot see a
 * tenant whose people are all in one open transaction, so the planner expects
 * it to hold none, and any index starting with `tenant_id` then looks as good
 * as the key. It picked the manager index, and each check walked every person
 * the import had written so far (20260924340000 has the whole story). The
 * walk up a manager chain, run for every row that names a manager, did the
 * same as a join.
 *
 * Asserted on the work rather than the clock, so a slow runner cannot fail it
 * and a fast one cannot hide it: the index entries the import read on
 * `people.person`, per row. A key lookup reads one or two; a check that walks
 * the tenant reads everybody imported so far. At 500 people that was 6,400 a
 * row before and 34 after. The time follows the square: the same foreign-key
 * checks over 20,000 people took 12 s before and 1.5 s after, and over 50,000
 * took 75 s and 4 s.
 */

const N = 500;
const TENANT = '00000000-0000-4000-8000-0000000000f1';
/** Who already had accounts before the import: whom everybody reports to. */
const HEADS = Array.from(
  { length: 8 },
  (_, i) => `00000000-0000-4000-8000-${String(0xe00 + i).padStart(12, '0')}`,
);
const HR_RELATIONS = {
  isSelf: false,
  isManager: false,
  isInManagerChain: false,
  isHr: true,
  isFinance: false,
  isAdmin: false,
};
const HEADERS = [
  'Given name',
  'Family name',
  'Work email',
  'Hire date',
  'Cost centre',
  'Country',
  'Manager',
];
const version = versionOf(1, [
  ...attributes,
  define({
    key: 'manager_id',
    label: { default: 'Manager' },
    dataType: 'person_ref',
    typeConfig: { kind: 'person_ref' },
  }),
]);

let stopPg: (() => Promise<void>) | undefined;
const clients: ReturnType<typeof postgres>[] = [];
let admin: ReturnType<typeof drizzle>;
let inTenant: ReturnType<typeof tenantTransaction>;

const ring = staticKeyRing([{ id: 'k1', key: randomBytes(32) }]);
const clock = fixedClock('2026-09-22T09:00:00.000Z');
const personDeps: PersonAccessDeps = {
  calendars: utcCalendars,
  people: drizzlePersonRepository(),
  reader: drizzlePersonReader(),
  schemas: drizzleSchemaVersions(),
  relations: drizzleRelations(),
  secrets: drizzleSecretStore(ring),
  uniques: drizzleUniqueClaims(ring),
  clock,
  newId: randomUUID,
};
const deps: CommitDeps = {
  calendars: utcCalendars,
  access: personAccess(personDeps),
  schemas: personDeps.schemas,
  relations: personDeps.relations,
  clock,
  newId: randomUUID,
  ledger: drizzleImportLedger(),
  rowScope: drizzleRowScope,
  reports: {
    store: localObjectStore({
      encryptionKey: randomBytes(32),
      signingKey: randomBytes(32),
      clock,
      baseUrl: 'https://people.test/v1/exports/files',
    }),
    index: drizzleReportIndex(),
  },
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
    '20260924220000_people_access_end.sql',
    '20260924220200_people_employment_period.sql',
    '20260924150000_people_unique_hash.sql',
    '20260923110000_people_completeness.sql',
    '20260923120000_people_webhooks.sql',
    '20260923130000_people_import_export.sql',
    '20260924250000_people_import_report.sql',
    '20260924170000_people_calendar.sql',
    '20260924170100_people_tenant_company.sql',
    '20260924340000_people_person_key_lookup.sql',
  ]) {
    await admin.execute(sql.raw(await migration(file)));
  }
  await admin.execute(sql`ALTER ROLE svc_people LOGIN PASSWORD 'svc_people'`);
  const asService = new URL(pg.url);
  asService.username = 'svc_people';
  asService.password = 'svc_people';
  // One connection: the plans the import's checks run on are the ones it
  // made while the table was small, as a pooled connection's would be.
  const serviceClient = postgres(asService.toString(), { max: 1 });
  clients.push(serviceClient);
  inTenant = tenantTransaction(drizzle(serviceClient));

  await inTenant(TENANT, async ({ tx }) => {
    await drizzleSchemaRepository().appendVersion(tx, TENANT, version, [], '2026-09-01');
    for (const [i, id] of HEADS.entries()) {
      // eslint-disable-next-line no-await-in-loop -- one transaction, one statement at a time
      await drizzlePersonRepository().create(
        tx,
        Person.rehydrate({
          id,
          tenantId: TENANT,
          status: 'active',
          identityAccountId: null,
          hireDate: '2026-01-01',
          lastWorkingDay: null,
        }),
        { givenName: `Head${String(i)}`, familyName: 'Person' },
      );
    }
  });
}, 180_000);

afterAll(async () => {
  for (const c of clients) await c.end();
  await stopPg?.();
});

describe(`a new tenant's first import of ${N.toLocaleString('en')} people`, () => {
  it('looks each row up by key, managers and all', async () => {
    const rows = Array.from({ length: N }, (_, i) => [
      `Given${String(i)}`,
      'Person',
      `p${String(i)}@new.test`,
      '2026-01-05',
      'CC-1',
      'GB',
      HEADS[i % HEADS.length] ?? '',
    ]);
    const file = await parseUpload(csv(HEADERS, rows));
    if (!file.ok) throw new Error(file.error.message);
    const proposed = await proposeMapping({
      file: file.value,
      version,
      relations: HR_RELATIONS,
      advisor: null,
    });
    const mapping = resolveMapping(proposed, {}, version, HR_RELATIONS);
    if (!mapping.ok) throw new Error(mapping.error.message);

    let entriesRead = 0;
    const start = performance.now();
    const result = await inTenantResult(inTenant, TENANT, async (tx) => {
      const imported = await commitImport(tx, deps, {
        ...asking,
        tenantId: TENANT,
        file: file.value,
        mapping: mapping.value,
      });
      // Every index entry this transaction read on `people.person`, the
      // foreign-key checks' included: they run in this backend too.
      const [read] = await tx.execute<{ n: number }>(sql`
        SELECT coalesce(sum(pg_stat_get_xact_tuples_returned(indexrelid)), 0)::int AS n
          FROM pg_index WHERE indrelid = 'people.person'::regclass`);
      entriesRead = read?.n ?? 0;
      return imported;
    });
    const ms = performance.now() - start;
    console.info(
      `importing ${N.toLocaleString('en')} people took ${String(Math.round(ms))} ms ` +
        `and read ${(entriesRead / N).toFixed(0)} person index entries a row`,
    );

    expect(result.ok && result.value.status === 'imported' && result.value.counts.created).toBe(N);
    const [reporting] = await admin.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM people.person
           WHERE tenant_id = ${TENANT}::uuid AND manager_id IS NOT NULL`,
    );
    expect(reporting?.n).toBe(N);
    // A key lookup reads one or two entries; a row writes a dozen checked
    // rows. A check that walks the tenant reads everybody imported so far.
    expect(entriesRead / N).toBeLessThan(100);
  }, 600_000);
});
