import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fixedClock } from '@kithena/domain-kit';
import { startPostgres } from '@kithena/testing';

import type { TenantCalendar } from '../../domain/org/calendar.js';
import { drizzleEmployeeNumbers } from '../../infrastructure/drizzle-org-store.js';
import { drizzlePersonRepository } from '../../infrastructure/drizzle-person-repository.js';
import {
  drizzleArrivals,
  drizzleLeavers,
  drizzlePersonReader,
  drizzleRelations,
  drizzleSchemaVersions,
} from '../../infrastructure/drizzle-person-reader.js';
import { drizzleRetentionStore } from '../../infrastructure/drizzle-retention-store.js';
import { drizzleSchemaRepository } from '../../infrastructure/drizzle-schema-repository.js';
import { staticKeyRing } from '../../infrastructure/envelope.js';
import { drizzleSecretStore } from '../../infrastructure/secret-store.js';
import { drizzleUniqueClaims } from '../../infrastructure/unique.js';
import { tenantTransaction } from '../../infrastructure/unit-of-work.js';
import { fixedCalendars } from '../org/org.js';
import { anonymiseDue } from '../retention/anonymise.js';
import { define, versionOf } from './in-memory.js';
import { inTenantResult, personAccess } from './person-access.js';
import type { Viewer } from './ports.js';
import { endAccessDue, startArrivals } from './start.js';

/**
 * PEO-110: one person, many employments, over Postgres as `svc_people`.
 *
 * Kiri worked for Acme NZ from January 2024 to 30 June 2025, left, and is
 * rehired into Acme US from 2 November 2026. The same record carries both
 * periods: access ends with the first and comes back with the second, the
 * employee number moves to the US scheme because NZ's does not fit it, "as
 * of" reads answer for either period, and retention — due on her first
 * employment — no longer is once she is back.
 */

const ACME = '00000000-0000-4000-8000-00000000000a';
const NZ = '00000000-0000-4000-8000-0000000000e1';
const US = '00000000-0000-4000-8000-0000000000e2';
const KIRI = '00000000-0000-4000-8000-0000000000a1';
const LUCY = '00000000-0000-4000-8000-0000000000a2';
const KIRI_ACCOUNT = '00000000-0000-4000-8000-0000000000b1';

const calendar: TenantCalendar = {
  defaultZone: 'Europe/Madrid',
  entities: new Map([
    [NZ, { id: NZ, name: 'Acme NZ', country: 'NZ', timeZone: 'Pacific/Auckland' }],
    [US, { id: US, name: 'Acme US', country: 'US', timeZone: 'America/Los_Angeles' }],
  ]),
  locations: new Map(),
};
const calendars = fixedCalendars(calendar);

const date = (key: string) =>
  define({ key, dataType: 'date', typeConfig: { kind: 'date' }, effectiveDated: true });
const phone = define({
  key: 'phone',
  classification: {
    classification: 'confidential',
    piiKind: 'contact',
    exportable: true,
    aiEligible: false,
    retention: { monthsAfterTermination: 6 },
  },
});

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
    calendars,
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
const jobDeps = (instant: string) => ({
  inTenant,
  people: drizzlePersonRepository(),
  reader: drizzlePersonReader(),
  calendars,
  clock: fixedClock(instant),
  newId,
});
const correlation = '00000000-0000-4000-8000-0000000000c1';

const viewer = (accountId: string, ...roles: string[]): Viewer => ({
  accountId,
  roles: new Set(roles),
});
const hr = viewer('00000000-0000-4000-8000-0000000000ff', 'hr');
const on = (personId: string, v: Viewer = hr) => ({
  tenantId: ACME,
  viewer: v,
  correlationId: correlation,
  personId,
});
const as = <T>(fn: (tx: Parameters<Parameters<typeof inTenant>[1]>[0]['tx']) => Promise<T>) =>
  inTenant(ACME, ({ tx }) => fn(tx));

const events = async (personId: string, name?: string) =>
  [
    ...(await admin.execute(sql`
      SELECT event_name, envelope FROM people.outbox
       WHERE aggregate_id = ${personId} ORDER BY created_at, event_id`)),
  ]
    .filter((row) => name === undefined || row['event_name'] === name)
    .map(
      (row) =>
        row['envelope'] as { effectiveFrom: string | null; payload: Record<string, unknown> },
    );

const anonymiseAt = (instant: string) =>
  as((tx) =>
    anonymiseDue({
      calendars,
      store: drizzleRetentionStore(),
      clock: fixedClock(instant),
      newEventId: newId,
    })(tx, {
      tenantId: ACME,
      personId: KIRI,
      actor: { kind: 'system', process: 'retention' },
      correlationId: correlation,
    }),
  );

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
    '20260923110000_people_completeness.sql',
    '20260923140000_people_retention.sql',
    '20260924150000_people_unique_hash.sql',
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
  const serviceClient = postgres(asService.toString(), { max: 4 });
  clients.push(serviceClient);
  inTenant = tenantTransaction(drizzle(serviceClient));

  await admin.execute(sql`
    INSERT INTO people.legal_entity (tenant_id, id, name, country, time_zone) VALUES
      (${ACME}::uuid, ${NZ}::uuid, 'Acme NZ', 'NZ', 'Pacific/Auckland'),
      (${ACME}::uuid, ${US}::uuid, 'Acme US', 'US', 'America/Los_Angeles')`);
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
        define({ key: 'legal_entity_id' }),
        date('hire_date'),
        date('last_working_day'),
        phone,
      ]),
      [],
      '2024-01-01',
    ),
  );
  // Seeded after the migration, so neither has a period row: the record reads
  // as its first employment, the way one written before PEO-110 does.
  await admin.execute(sql`
    INSERT INTO people.person
      (tenant_id, id, status, identity_account_id, hire_date, legal_entity_id, employee_number,
       given_name, family_name, work_email, custom, schema_version)
    VALUES
      (${ACME}::uuid, ${KIRI}::uuid, 'active', ${KIRI_ACCOUNT}::uuid, '2024-01-08', ${NZ}::uuid, 'NZ-0003',
       'Kiri', 'Ngata', 'kiri@acme.test', ${JSON.stringify({ phone: '+64 21 000 000' })}::jsonb, 1),
      (${ACME}::uuid, ${LUCY}::uuid, 'active', NULL, '2024-01-08', ${US}::uuid, NULL,
       'Lucy', 'Park', 'lucy@acme.test', '{}'::jsonb, 1)
  `);
  // Their history rows, as a hire would have written them.
  await admin.execute(sql`
    INSERT INTO people.person_attribute_history
      (id, tenant_id, person_id, attribute_key, value, effective_from, recorded_at, actor)
    VALUES
      ('01890000-0000-7000-8000-00000000f001', ${ACME}::uuid, ${KIRI}::uuid, 'hire_date',
       '"2024-01-08"'::jsonb, '2024-01-08', '2024-01-02', '{"kind":"system","process":"seed"}'::jsonb)
  `);
});

afterAll(async () => {
  for (const c of clients) await c.end();
  clients = [];
  await stopPg?.();
});

describe('leaving', () => {
  it('ends the first employment with its period, and access at the end of the last day', async () => {
    const notice = await inTenantResult(inTenant, ACME, (tx) =>
      at('2025-06-20T00:00:00.000Z').giveNotice(tx, { ...on(KIRI), lastWorkingDay: '2025-06-30' }),
    );
    expect(notice.ok).toBe(true);
    const ended = await inTenantResult(inTenant, ACME, (tx) =>
      at('2025-06-30T00:00:00.000Z').terminate(tx, {
        ...on(KIRI),
        lastWorkingDay: '2025-06-30',
        reason: 'resigned',
        eligibleForRehire: true,
      }),
    );
    expect(ended.ok && ended.value.status).toBe('terminated');
    expect(
      await endAccessDue({ ...jobDeps('2025-06-30T12:30:00.000Z'), leavers: drizzleLeavers() })(
        ACME,
        correlation,
      ),
    ).toMatchObject({ ended: 1 });

    const periods = await as((tx) => at('2025-07-01T00:00:00.000Z').employmentPeriods(tx, on(KIRI)));
    expect(periods.ok && periods.value).toEqual([
      {
        period: 1,
        // A record from before periods existed has no entity on its first.
        legalEntityId: null,
        startedOn: '2024-01-08',
        lastWorkingDay: '2025-06-30',
        leavingReason: 'resigned',
        eligibleForRehire: true,
        noticeFrom: 'active',
        rehireOverrideReason: null,
      },
    ]);
  });
});

describe('coming back', () => {
  const rehireAt = '2026-09-30T12:00:00.000Z';

  it('is HR’s alone', async () => {
    const refused = await inTenantResult(inTenant, ACME, (tx) =>
      at(rehireAt).rehire(tx, {
        ...on(KIRI, viewer('00000000-0000-4000-8000-0000000000fa', 'people_admin')),
        startDate: '2026-11-02',
      }),
    );
    expect(!refused.ok && refused.error.code).toBe('FORBIDDEN');
  });

  it('opens a second period on the same record, pre-hire, numbered by the entity she rejoins', async () => {
    const back = await inTenantResult(inTenant, ACME, (tx) =>
      at(rehireAt).rehire(tx, { ...on(KIRI), startDate: '2026-11-02', legalEntityId: US }),
    );
    expect(back.ok && back.value.status).toBe('pre_hire');
    expect(back.ok && back.value.attributes).toMatchObject({
      legal_entity_id: US,
      // NZ-0003 is not a number the US scheme writes, so she takes its next.
      employee_number: 'US0007',
      hire_date: '2026-11-02',
    });
    expect(back.ok && back.value.attributes['last_working_day']).toBeUndefined();

    const moved = await events(KIRI, 'people.person.status_changed');
    expect(moved.at(-1)).toMatchObject({
      effectiveFrom: '2026-11-02',
      payload: { previous: 'terminated', next: 'pre_hire', reason: 'rehired' },
    });
    const hired = await events(KIRI, 'people.person.hired');
    expect(hired).toHaveLength(1);
    expect(hired[0]).toMatchObject({
      effectiveFrom: '2026-11-02',
      payload: {
        identityAccountId: KIRI_ACCOUNT,
        legalEntityId: US,
        employment: { from: '2026-11-02', to: null },
        status: 'pending',
      },
    });
    expect((await events(KIRI, 'people.person.identity_facts_changed')).at(-1)).toMatchObject({
      payload: { identityAccountId: KIRI_ACCOUNT, employmentStart: '2026-11-02' },
    });
    // Not yet: her access comes back when the new employment starts.
    expect(await events(KIRI, 'people.person.access_restored')).toEqual([]);
  });

  it('restores her access on her first day, where she now works', async () => {
    // 07:30 UTC on 2 November is still the 1st in Los Angeles.
    const start = (instant: string) =>
      startArrivals({ ...jobDeps(instant), arrivals: drizzleArrivals() })(ACME, correlation);
    expect(await start('2026-11-02T07:30:00.000Z')).toMatchObject({ started: 0 });
    expect(await start('2026-11-02T08:30:00.000Z')).toMatchObject({ started: 1 });

    expect(await events(KIRI, 'people.person.access_restored')).toEqual([
      expect.objectContaining({
        effectiveFrom: '2026-11-02',
        payload: {
          personId: KIRI,
          identityAccountId: KIRI_ACCOUNT,
          restoredAt: '2026-11-02T08:30:00.000Z',
          reason: 'rehired',
        },
      }),
    ]);
    const [row] = await admin.execute(
      sql`SELECT status, access_ended_at FROM people.person WHERE id = ${KIRI}::uuid`,
    );
    expect(row).toMatchObject({ status: 'active', access_ended_at: null });
  });

  it('keeps both employments, and answers "as of" for either', async () => {
    const periods = await as((tx) => at('2026-11-15T00:00:00.000Z').employmentPeriods(tx, on(KIRI)));
    expect(periods.ok && periods.value.map((p) => [p.period, p.legalEntityId, p.startedOn, p.lastWorkingDay])).toEqual([
      [1, null, '2024-01-08', '2025-06-30'],
      [2, US, '2026-11-02', null],
    ]);

    const asOf = async (day: string) => {
      const read = await as((tx) => at('2026-11-15T00:00:00.000Z').read(tx, { ...on(KIRI), asOf: day }));
      if (!read.ok) throw new Error(read.error.code);
      return [read.value.attributes['hire_date'], read.value.attributes['last_working_day']];
    };
    expect(await asOf('2025-01-01')).toEqual(['2024-01-08', undefined]);
    expect(await asOf('2026-01-01')).toEqual(['2024-01-08', '2025-06-30']);
    expect(await asOf('2026-11-15')).toEqual(['2026-11-02', undefined]);
  });

  it('is not erased by a retention clock that ran from the first employment', async () => {
    // Six months after 30 June 2025 was due at the end of 2025; she is back.
    const due = await anonymiseAt('2027-01-15T00:00:00.000Z');
    expect(due.ok && due.value.cleared).toEqual([]);
    expect(await events(KIRI, 'people.person.anonymised')).toEqual([]);
  });

  it('runs retention from the latest employment’s end once she leaves again', async () => {
    const left = await inTenantResult(inTenant, ACME, (tx) =>
      at('2027-03-31T20:00:00.000Z').terminate(tx, {
        ...on(KIRI),
        lastWorkingDay: '2027-03-31',
        reason: 'end_of_contract',
      }),
    );
    expect(left.ok && left.value.status).toBe('terminated');
    // Due 30 September 2027 in Los Angeles, not six months after 2025.
    expect((await anonymiseAt('2027-09-30T06:00:00.000Z')).ok).toBe(true);
    expect(await events(KIRI, 'people.person.anonymised')).toEqual([]);
    const due = await anonymiseAt('2027-09-30T08:00:00.000Z');
    expect(due.ok && due.value.cleared).toEqual(['phone']);
  });
});

describe('eligibility', () => {
  it('refuses somebody marked not eligible, and lets HR override with a reason it keeps', async () => {
    const out = await inTenantResult(inTenant, ACME, (tx) =>
      at('2026-09-30T20:00:00.000Z').terminate(tx, {
        ...on(LUCY),
        lastWorkingDay: '2026-09-30',
        reason: 'dismissed',
        eligibleForRehire: false,
      }),
    );
    expect(out.ok).toBe(true);

    const rehire = (overrideReason?: string) =>
      inTenantResult(inTenant, ACME, (tx) =>
        at('2026-12-01T20:00:00.000Z').rehire(tx, {
          ...on(LUCY),
          startDate: '2026-12-01',
          ...(overrideReason === undefined ? {} : { overrideReason }),
        }),
      );
    const refused = await rehire();
    expect(!refused.ok && refused.error.code).toBe('NOT_ELIGIBLE_FOR_REHIRE');
    expect(await events(LUCY, 'people.person.hired')).toEqual([]);
    expect(await events(LUCY, 'people.person.rehire_override')).toEqual([]);

    const overridden = await rehire('Dismissal overturned at tribunal');
    // The start has come on her calendar: active at once.
    expect(overridden.ok && overridden.value.status).toBe('active');
    // She had no number and her entity numbers its people: its next, as a new hire.
    expect(overridden.ok && overridden.value.attributes['employee_number']).toBe('US0008');

    const periods = await as((tx) => at('2026-12-02T00:00:00.000Z').employmentPeriods(tx, on(LUCY)));
    expect(periods.ok && periods.value.at(-1)).toMatchObject({
      period: 2,
      rehireOverrideReason: 'Dismissal overturned at tribunal',
    });

    // Its own audit event, through the outbox with the rehire: the HR user
    // who overrode, whom, which period, why — and no other personal data.
    const audit = await admin.execute(sql`
      SELECT envelope FROM people.outbox
       WHERE aggregate_id = ${LUCY} AND event_name = 'people.person.rehire_override'`);
    expect([...audit].map((r) => r['envelope'])).toEqual([
      expect.objectContaining({
        effectiveFrom: '2026-12-01',
        actor: { kind: 'user', userId: hr.accountId },
        payload: { personId: LUCY, period: 2, reason: 'Dismissal overturned at tribunal' },
      }),
    ]);
    // Kiri's rehire overrode nothing, so raised none.
    expect(await events(KIRI, 'people.person.rehire_override')).toEqual([]);
  });
});
