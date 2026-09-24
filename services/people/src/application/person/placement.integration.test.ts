import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fixedClock } from '@kithena/domain-kit';
import { startPostgres } from '@kithena/testing';

import { drizzleEmployeeNumbers, drizzleOrgStore } from '../../infrastructure/drizzle-org-store.js';
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
import { define, versionOf } from './in-memory.js';
import { inTenantResult, personAccess, type PlacementChange } from './person-access.js';
import type { Viewer } from './ports.js';

/**
 * PEO-123: placing a person, over Postgres as `svc_people`.
 *
 * Ana has worked for Acme Spain in Madrid since January 2024. She moves to
 * the Barcelona office (same entity: no new employment), then to San
 * Francisco from 1 September 2026, recorded late on the 24th — Acme US, so a
 * transfer: her Spanish period closes on 31 August, a US one opens on the
 * 1st, she takes the US scheme's number, and her day becomes Los Angeles's.
 * HR then corrects the office to Los Angeles, same date: a row carrying
 * `supersedes`, not a second move.
 */

const ACME = '00000000-0000-4000-8000-00000000000a';
const ES = '00000000-0000-4000-8000-0000000000e1';
const US = '00000000-0000-4000-8000-0000000000e2';
const MAD = '00000000-0000-4000-8000-0000000000d1';
const BCN = '00000000-0000-4000-8000-0000000000d2';
const SFO = '00000000-0000-4000-8000-0000000000d3';
const LAX = '00000000-0000-4000-8000-0000000000d4';
const OLD = '00000000-0000-4000-8000-0000000000d5';
const ANA = '00000000-0000-4000-8000-0000000000a1';

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

const at = (instant: string) =>
  personAccess({
    calendars: drizzleOrgStore(),
    people: drizzlePersonRepository(),
    reader: drizzlePersonReader(),
    schemas: drizzleSchemaVersions(),
    relations: drizzleRelations(),
    secrets: drizzleSecretStore(ring),
    uniques: drizzleUniqueClaims(ring),
    numbering: drizzleEmployeeNumbers(),
    clock: fixedClock(instant),
    newId,
  });
const correlation = '00000000-0000-4000-8000-0000000000c1';
const viewer = (accountId: string, ...roles: string[]): Viewer => ({
  accountId,
  roles: new Set(roles),
});
const hr = viewer('00000000-0000-4000-8000-0000000000ff', 'hr');
const on = (v: Viewer = hr) => ({
  tenantId: ACME,
  viewer: v,
  correlationId: correlation,
  personId: ANA,
});
const as = <T>(fn: (tx: Parameters<Parameters<typeof inTenant>[1]>[0]['tx']) => Promise<T>) =>
  inTenant(ACME, ({ tx }) => fn(tx));
const place = (instant: string, change: PlacementChange, v: Viewer = hr) =>
  inTenantResult(inTenant, ACME, (tx) => at(instant).place(tx, { ...on(v), ...change }));

const events = async (name: string) =>
  [
    ...(await admin.execute(sql`
      SELECT envelope FROM people.outbox
       WHERE aggregate_id = ${ANA} AND event_name = ${name} ORDER BY created_at, event_id`)),
  ].map(
    (row) =>
      row['envelope'] as {
        effectiveFrom: string | null;
        causationId: string | null;
        payload: Record<string, unknown>;
      },
  );
const periods = async () => {
  const read = await as((tx) => at('2026-09-24T12:00:00.000Z').employmentPeriods(tx, on()));
  if (!read.ok) throw new Error(read.error.code);
  return read.value.map((p) => [p.period, p.legalEntityId, p.startedOn, p.lastWorkingDay]);
};
const asOf = async (day: string) => {
  const read = await as((tx) => at('2026-09-24T12:00:00.000Z').read(tx, { ...on(), asOf: day }));
  if (!read.ok) throw new Error(read.error.code);
  return [read.value.attributes['legal_entity_id'], read.value.attributes['location_id']];
};

const migration = (file: string): Promise<string> =>
  readFile(new URL(`../../../../../migrations/${file}`, import.meta.url), 'utf8');

const dated = (key: string, dataType: 'text' | 'legal_entity_ref' = 'text') =>
  define({ key, dataType, typeConfig: { kind: dataType }, effectiveDated: true });

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
    '20260923110000_people_completeness.sql',
    '20260924150000_people_unique_hash.sql',
    '20260924170000_people_calendar.sql',
    '20260924170100_people_tenant_company.sql',
    '20260924200000_people_employee_numbering.sql',
    '20260924270100_people_entitlements.sql',
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

  await admin.execute(sql`
    INSERT INTO people.legal_entity (tenant_id, id, name, country, time_zone) VALUES
      (${ACME}::uuid, ${ES}::uuid, 'Acme Spain', 'ES', 'Europe/Madrid'),
      (${ACME}::uuid, ${US}::uuid, 'Acme US', 'US', 'America/Los_Angeles')`);
  await admin.execute(sql`
    INSERT INTO people.location (tenant_id, id, legal_entity_id, name, country, archived_at) VALUES
      (${ACME}::uuid, ${MAD}::uuid, ${ES}::uuid, 'Madrid', 'ES', NULL),
      (${ACME}::uuid, ${BCN}::uuid, ${ES}::uuid, 'Barcelona', 'ES', NULL),
      (${ACME}::uuid, ${SFO}::uuid, ${US}::uuid, 'San Francisco', 'US', NULL),
      (${ACME}::uuid, ${LAX}::uuid, ${US}::uuid, 'Los Angeles', 'US', NULL),
      (${ACME}::uuid, ${OLD}::uuid, ${ES}::uuid, 'Valencia', 'ES', now())`);
  await admin.execute(sql`
    INSERT INTO people.location_zone (tenant_id, id, location_id, effective_from, time_zone) VALUES
      (${ACME}::uuid, gen_random_uuid(), ${MAD}::uuid, '2020-01-01', 'Europe/Madrid'),
      (${ACME}::uuid, gen_random_uuid(), ${BCN}::uuid, '2020-01-01', 'Europe/Madrid'),
      (${ACME}::uuid, gen_random_uuid(), ${SFO}::uuid, '2020-01-01', 'America/Los_Angeles'),
      (${ACME}::uuid, gen_random_uuid(), ${LAX}::uuid, '2020-01-01', 'America/Los_Angeles'),
      (${ACME}::uuid, gen_random_uuid(), ${OLD}::uuid, '2020-01-01', 'Europe/Madrid')`);
  await admin.execute(sql`
    INSERT INTO people.employee_numbering (tenant_id, legal_entity_id, prefix, digits, next_value)
    VALUES (${ACME}::uuid, ${US}::uuid, 'US', 4, 7)`);
  await as((tx) =>
    drizzleSchemaRepository().appendVersion(
      tx,
      ACME,
      versionOf(1, [
        define({ key: 'given_name' }),
        define({ key: 'family_name' }),
        define({ key: 'work_email' }),
        define({ key: 'employee_number' }),
        dated('legal_entity_id', 'legal_entity_ref'),
        dated('location_id'),
        dated('cost_centre'),
      ]),
      [],
      '2024-01-01',
    ),
  );
  await admin.execute(sql`
    INSERT INTO people.person
      (tenant_id, id, status, hire_date, legal_entity_id, location_id, employee_number,
       given_name, family_name, work_email, custom, schema_version)
    VALUES
      (${ACME}::uuid, ${ANA}::uuid, 'active', '2024-01-08', ${ES}::uuid, ${MAD}::uuid, 'ES-0003',
       'Ana', 'García', 'ana@acme.test', '{}'::jsonb, 1)`);
  await admin.execute(sql`
    INSERT INTO people.employment_period (tenant_id, person_id, period, legal_entity_id, started_on)
    VALUES (${ACME}::uuid, ${ANA}::uuid, 1, ${ES}::uuid, '2024-01-08')`);
  await admin.execute(sql`
    INSERT INTO people.person_attribute_history
      (id, tenant_id, person_id, attribute_key, value, effective_from, recorded_at, actor)
    VALUES
      ('01890000-0000-7000-8000-00000000f001', ${ACME}::uuid, ${ANA}::uuid, 'legal_entity_id',
       ${JSON.stringify(ES)}::jsonb, '2024-01-08', '2024-01-02', '{"kind":"system","process":"seed"}'::jsonb),
      ('01890000-0000-7000-8000-00000000f002', ${ACME}::uuid, ${ANA}::uuid, 'location_id',
       ${JSON.stringify(MAD)}::jsonb, '2024-01-08', '2024-01-02', '{"kind":"system","process":"seed"}'::jsonb)
  `);
});

afterAll(async () => {
  for (const c of clients) await c.end();
  clients = [];
  await stopPg?.();
});

describe('who may', () => {
  it('is HR’s alone', async () => {
    const admin = viewer('00000000-0000-4000-8000-0000000000fa', 'people_admin');
    const refused = await place('2026-06-01T12:00:00.000Z', { locationId: BCN }, admin);
    expect(!refused.ok && refused.error.code).toBe('FORBIDDEN');
  });
});

describe('a move inside the entity', () => {
  it('changes the office, dated, and no employment period', async () => {
    const moved = await place('2026-06-01T12:00:00.000Z', { locationId: BCN, costCentre: 'CC-9' });
    expect(moved.ok && moved.value.attributes).toMatchObject({ location_id: BCN, legal_entity_id: ES });
    expect((await events('people.person.org_changed')).at(-1)).toMatchObject({
      effectiveFrom: '2026-06-01',
      payload: { personId: ANA, legalEntityId: ES, locationId: BCN, costCentre: 'CC-9', orgUnitId: null },
    });
    expect(await periods()).toEqual([[1, ES, '2024-01-08', null]]);
  });

  it('answers a retry with the record and raises nothing', async () => {
    const before = (await events('people.person.org_changed')).length;
    const again = await place('2026-06-01T13:00:00.000Z', { locationId: BCN, costCentre: 'CC-9' });
    expect(again.ok).toBe(true);
    expect(await events('people.person.org_changed')).toHaveLength(before);
  });
});

describe('refusals', () => {
  it('refuses the future, an archived office, a mismatch and an unknown entity', async () => {
    const future = await place('2026-06-02T12:00:00.000Z', { locationId: MAD, effectiveFrom: '2026-07-01' });
    expect(!future.ok && future.error.code).toBe('PLACEMENT_IN_FUTURE');
    const archived = await place('2026-06-02T12:00:00.000Z', { locationId: OLD });
    expect(!archived.ok && archived.error.code).toBe('LOCATION_ARCHIVED');
    const mismatch = await place('2026-06-02T12:00:00.000Z', { locationId: SFO, legalEntityId: ES });
    expect(!mismatch.ok && mismatch.error.code).toBe('LOCATION_NOT_IN_ENTITY');
    const unknown = await place('2026-06-02T12:00:00.000Z', {
      legalEntityId: '00000000-0000-4000-8000-0000000000e9',
    });
    expect(!unknown.ok && unknown.error.code).toBe('LEGAL_ENTITY_NOT_FOUND');
  });
});

describe('a transfer to another legal entity', () => {
  it('closes the Spanish employment and opens a US one from the date, renumbered', async () => {
    // Recorded on the 24th, effective the 1st: a move recorded late, not a correction.
    const moved = await place('2026-09-24T12:00:00.000Z', {
      locationId: SFO,
      effectiveFrom: '2026-09-01',
    });
    expect(moved.ok && moved.value.attributes).toMatchObject({
      legal_entity_id: US,
      location_id: SFO,
      // ES-0003 is not a number the US scheme writes.
      employee_number: 'US0007',
    });
    expect(await periods()).toEqual([
      [1, ES, '2024-01-08', '2026-08-31'],
      [2, US, '2026-09-01', null],
    ]);
    const [row] = await admin.execute(
      sql`SELECT status, hire_date::text AS hire_date FROM people.person WHERE id = ${ANA}::uuid`,
    );
    // Continuous service: still active, still hired in 2024.
    expect(row).toMatchObject({ status: 'active', hire_date: '2024-01-08' });
    expect((await events('people.person.org_changed')).at(-1)).toMatchObject({
      effectiveFrom: '2026-09-01',
      payload: { legalEntityId: US, locationId: SFO },
    });
  });

  it('reads as it was on either side of the move', async () => {
    expect(await asOf('2025-01-01')).toEqual([ES, MAD]);
    expect(await asOf('2026-08-15')).toEqual([ES, BCN]);
    expect(await asOf('2026-09-15')).toEqual([US, SFO]);
  });

  it('corrects a placement dated the same day, superseding it', async () => {
    const standing = await as((tx) =>
      at('2026-09-24T12:00:00.000Z').history(tx, { ...on(), attributeKey: 'location_id' }),
    );
    const sfo = standing.ok ? standing.value.find((e) => e.value === SFO) : undefined;
    const fixed = await place('2026-09-24T12:00:00.000Z', { locationId: LAX, effectiveFrom: '2026-09-01' });
    expect(fixed.ok && fixed.value.attributes['location_id']).toBe(LAX);
    const corrected = await events('people.person.attribute_corrected');
    expect(corrected.at(-1)).toMatchObject({
      effectiveFrom: '2026-09-01',
      payload: { supersedes: sfo?.id, reason: 'Placement corrected' },
    });
    expect(await asOf('2026-09-15')).toEqual([US, LAX]);
    // Same entity: the periods stand as the transfer left them.
    expect(await periods()).toHaveLength(2);
  });
});

describe('whose day it is', () => {
  it('judges today on the calendar the move takes them to', async () => {
    // 03:00 UTC on 25 September: the 25th in Madrid, still the 24th in Los Angeles.
    const back = await place('2026-09-25T03:00:00.000Z', { locationId: MAD });
    expect(back.ok).toBe(true);
    // Back to Madrid, a transfer judged on Madrid's day.
    expect((await events('people.person.org_changed')).at(-1)).toMatchObject({
      effectiveFrom: '2026-09-25',
      payload: { legalEntityId: ES, locationId: MAD },
    });
    expect((await periods()).at(-1)).toEqual([3, ES, '2026-09-25', null]);
  });
});
