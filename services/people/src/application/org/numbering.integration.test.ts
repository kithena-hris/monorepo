import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fixedClock } from '@kithena/domain-kit';
import { startPostgres } from '@kithena/testing';

import { Person } from '../../domain/person/person.js';
import {
  drizzleEmployeeNumbers,
  drizzleOrgStore,
} from '../../infrastructure/drizzle-org-store.js';
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
import { inTenantResult, personAccess } from '../person/person-access.js';
import type { Viewer } from '../person/ports.js';
import { orgAdmin, utcCalendars } from './org.js';

/**
 * PEO-101: employee numbering per legal entity, over Postgres. Numbers are
 * handed out on hire, gap-free and unique when hires race, a refused hire
 * hands its number back, and a typed or imported number is held to the
 * entity's format and uniqueness and moves the sequence past itself.
 */

const ACME = '00000000-0000-4000-8000-00000000000a';
const SPAIN = '00000000-0000-4000-8000-0000000000e1';
const FRANCE = '00000000-0000-4000-8000-0000000000e2';
const person = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

let stopPg: (() => Promise<void>) | undefined;
let clients: ReturnType<typeof postgres>[] = [];
let admin: ReturnType<typeof drizzle>;
let inTenant: ReturnType<typeof tenantTransaction>;

const ring = staticKeyRing([{ id: 'k1', key: randomBytes(32) }]);
let ids = 0;
const newId = () => {
  ids += 1;
  return `01890000-0000-7000-8000-${String(ids).padStart(12, '0')}`;
};
const clock = fixedClock('2026-09-22T09:00:00.000Z');
const numbering = drizzleEmployeeNumbers();
const people = personAccess({
  calendars: utcCalendars,
  people: drizzlePersonRepository(),
  reader: drizzlePersonReader(),
  schemas: drizzleSchemaVersions(),
  relations: drizzleRelations(),
  secrets: drizzleSecretStore(ring),
  uniques: drizzleUniqueClaims(ring),
  clock,
  newId,
  numbering,
});
const org = orgAdmin({ store: drizzleOrgStore(), numbers: numbering, clock, newId });

const viewer = (...roles: string[]): Viewer => ({
  accountId: '00000000-0000-4000-8000-0000000000ff',
  roles: new Set(roles),
});
const hr = viewer('hr');
const asking = (v: Viewer) => ({
  tenantId: ACME,
  viewer: v,
  correlationId: '00000000-0000-4000-8000-0000000000c1',
});

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
    '20260926140000_people_visibility_rules.sql',
    '20260926180000_people_pending_change.sql',
    '20260922170000_people_person.sql',
    '20260924220000_people_access_end.sql',
    '20260926143000_people_duplicates.sql',
    '20260924220200_people_employment_period.sql',
    '20260924150000_people_unique_hash.sql',
    '20260923110000_people_completeness.sql',
    '20260924170000_people_calendar.sql',
    '20260924170100_people_tenant_company.sql',
    '20260924200000_people_employee_numbering.sql',
  ]) {
    await admin.execute(sql.raw(await migration(file)));
  }
  await admin.execute(sql`ALTER ROLE svc_people LOGIN PASSWORD 'svc_people'`);
  const asService = new URL(pg.url);
  asService.username = 'svc_people';
  asService.password = 'svc_people';
  const serviceClient = postgres(asService.toString(), { max: 12 });
  clients.push(serviceClient);
  inTenant = tenantTransaction(drizzle(serviceClient));

  await admin.execute(sql`
    INSERT INTO people.legal_entity (tenant_id, id, name, country, time_zone) VALUES
      (${ACME}::uuid, ${SPAIN}::uuid, 'Acme España', 'ES', 'Europe/Madrid'),
      (${ACME}::uuid, ${FRANCE}::uuid, 'Acme France', 'FR', 'Europe/Paris')`);
  await inTenant(ACME, ({ tx }) =>
    drizzleSchemaRepository().appendVersion(
      tx,
      ACME,
      versionOf(1, [
        define({ key: 'given_name' }),
        define({ key: 'family_name' }),
        define({ key: 'work_email' }),
        // No uniqueness of its own: a scheme claims it tenant-wide regardless.
        define({ key: 'employee_number' }),
      ]),
      [],
      '2026-09-01',
    ),
  );
  // Thirteen provisional people in Spain, one in France (13). The eleventh
  // has no name, so hiring them is refused.
  const repo = drizzlePersonRepository();
  await inTenant(ACME, async ({ tx }) => {
    for (let n = 1; n <= 14; n += 1) {
      await repo.create(
        tx,
        Person.rehydrate({
          id: person(n),
          tenantId: ACME,
          status: 'provisional',
          identityAccountId: null,
          hireDate: null,
          lastWorkingDay: null,
        }),
        {
          legalEntityId: n === 13 ? FRANCE : SPAIN,
          givenName: n === 11 ? null : `P${String(n)}`,
          familyName: 'Test',
          workEmail: `p${String(n)}@acme.test`,
        },
      );
    }
  });
});

afterAll(async () => {
  for (const c of clients) await c.end();
  clients = [];
  await stopPg?.();
});

const hire = (n: number) =>
  inTenantResult(inTenant, ACME, (tx) =>
    people.hire(tx, { ...asking(hr), personId: person(n), hireDate: '2026-09-01' }),
  );
const numberOf = async (n: number) =>
  [
    ...(await admin.execute(
      sql`SELECT employee_number FROM people.person WHERE id = ${person(n)}::uuid`,
    )),
  ][0]?.['employee_number'];
const write = (n: number, value: string) =>
  inTenantResult(inTenant, ACME, (tx) =>
    people.update(tx, {
      ...asking(hr),
      personId: person(n),
      changes: { employee_number: value },
    }),
  );

describe('setting a scheme', () => {
  it('is people_admin’s, and raises an event', async () => {
    const refused = await inTenantResult(inTenant, ACME, (tx) =>
      org.setNumbering(tx, {
        ...asking(hr),
        legalEntityId: SPAIN,
        prefix: 'ES-',
        digits: 5,
        start: 100,
      }),
    );
    expect(!refused.ok && refused.error.code).toBe('FORBIDDEN');

    const set = await inTenantResult(inTenant, ACME, (tx) =>
      org.setNumbering(tx, {
        ...asking(viewer('people_admin')),
        legalEntityId: SPAIN,
        prefix: 'ES-',
        digits: 5,
        start: 100,
      }),
    );
    expect(set.ok && set.value).toEqual({
      legalEntityId: SPAIN,
      prefix: 'ES-',
      digits: 5,
      nextValue: 100,
    });
    const events = await admin.execute(
      sql`SELECT count(*) AS n FROM people.outbox WHERE event_name = 'people.employee_numbering.set'`,
    );
    expect(Number([...events][0]?.['n'])).toBe(1);
  });
});

describe('hiring', () => {
  it('numbers ten racing hires gap-free and uniquely, and a refused hire hands its number back', async () => {
    const results = await Promise.all([1, 2, 3, 4, 5, 11, 6, 7, 8, 9, 10].map(hire));
    expect(results.filter((r) => !r.ok)).toHaveLength(1);

    const numbers = await Promise.all([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(numberOf));
    expect(numbers.map(String).toSorted()).toEqual(
      Array.from({ length: 10 }, (_, i) => `ES-${String(100 + i).padStart(5, '0')}`),
    );
    expect(await numberOf(11)).toBeNull();
  });

  it('leaves an entity with no scheme unnumbered', async () => {
    expect((await hire(13)).ok).toBe(true);
    expect(await numberOf(13)).toBeNull();
  });
});

describe('a number typed or imported', () => {
  it('is held to the format', async () => {
    const refused = await write(12, 'ES-42');
    expect(!refused.ok && refused.error.code).toBe('VALUE_INVALID');
  });

  it('is unique, refused cleanly, and the sequence moves past it', async () => {
    expect((await write(12, 'ES-00500')).ok).toBe(true);
    const taken = await write(1, 'ES-00500');
    expect(!taken.ok && taken.error.code).toBe('UNIQUE_VALUE_TAKEN');

    const next = await inTenant(ACME, ({ tx }) => numbering.scheme(tx, ACME, SPAIN));
    expect(next?.nextValue).toBe(501);
  });

  it('is skipped by the next hire when somebody elsewhere already holds it', async () => {
    // France does not number; somebody there was given what Spain hands out next.
    expect((await write(13, 'ES-00501')).ok).toBe(true);
    expect((await hire(14)).ok).toBe(true);
    expect(await numberOf(14)).toBe('ES-00502');
  });
});
