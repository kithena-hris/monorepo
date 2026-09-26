import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fixedClock } from '@kithena/domain-kit';
import { startPostgres } from '@kithena/testing';

import type { TenantCalendar } from '../../domain/org/calendar.js';
import { drizzlePersonRepository } from '../../infrastructure/drizzle-person-repository.js';
import {
  drizzleLeavers,
  drizzlePersonReader,
  drizzleRelations,
  drizzleSchemaVersions,
} from '../../infrastructure/drizzle-person-reader.js';
import { drizzleSchemaRepository } from '../../infrastructure/drizzle-schema-repository.js';
import { staticKeyRing } from '../../infrastructure/envelope.js';
import { drizzleSecretStore } from '../../infrastructure/secret-store.js';
import { drizzleUniqueClaims } from '../../infrastructure/unique.js';
import { tenantTransaction } from '../../infrastructure/unit-of-work.js';
import { fixedCalendars } from '../org/org.js';
import { define, versionOf } from './in-memory.js';
import { inTenantResult, personAccess } from './person-access.js';
import type { Viewer } from './ports.js';
import { endAccessDue } from './start.js';

/**
 * PEO-109: access ends with employment, over Postgres as `svc_people`.
 *
 * Kiri (Auckland) and Lucy (Los Angeles) both left on 30 September. At 11:30
 * UTC that day Auckland's 30th has ended and Los Angeles's has most of a day
 * to go, so the hourly job ends one and waits for the other's own midnight —
 * and ends nobody twice. Marco was dismissed for cause and HR ended his access
 * at once.
 */

const ACME = '00000000-0000-4000-8000-00000000000a';
const NZ = '00000000-0000-4000-8000-0000000000e1';
const US = '00000000-0000-4000-8000-0000000000e2';
const KIRI = '00000000-0000-4000-8000-0000000000a1';
const LUCY = '00000000-0000-4000-8000-0000000000a2';
const MARCO = '00000000-0000-4000-8000-0000000000a3';
const ANA = '00000000-0000-4000-8000-0000000000a4';
const KIRI_ACCOUNT = '00000000-0000-4000-8000-0000000000b1';
const MARCO_ACCOUNT = '00000000-0000-4000-8000-0000000000b3';
const ANA_ACCOUNT = '00000000-0000-4000-8000-0000000000b4';
// On notice, last day 30 September, and HR never confirmed the termination.
const AROHA = '00000000-0000-4000-8000-0000000000a5';
const DEV = '00000000-0000-4000-8000-0000000000a6';
const AROHA_ACCOUNT = '00000000-0000-4000-8000-0000000000b5';
const DEV_ACCOUNT = '00000000-0000-4000-8000-0000000000b6';
// On notice in Los Angeles, last day 30 September; HR later moves it to 1 October.
const ELI = '00000000-0000-4000-8000-0000000000a7';
const ELI_ACCOUNT = '00000000-0000-4000-8000-0000000000b7';
const AROHA_ROW = '01890000-0000-7000-8000-00000000f0a5';
const ELI_ROW = '01890000-0000-7000-8000-00000000f0a7';

const calendar: TenantCalendar = {
  defaultZone: 'Europe/Madrid',
  entities: new Map([
    [NZ, { id: NZ, name: 'Acme NZ', country: 'NZ', timeZone: 'Pacific/Auckland' }],
    [US, { id: US, name: 'Acme US', country: 'US', timeZone: 'America/Los_Angeles' }],
  ]),
  locations: new Map(),
};
const calendars = fixedCalendars(calendar);

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

const accessAt = (at: string) =>
  personAccess({
    calendars,
    people: drizzlePersonRepository(),
    reader: drizzlePersonReader(),
    schemas: drizzleSchemaVersions(),
    relations: drizzleRelations(),
    secrets: drizzleSecretStore(ring),
    uniques: drizzleUniqueClaims(ring),
    clock: fixedClock(at),
    newId,
  });

const jobAt = (at: string) =>
  endAccessDue({
    inTenant,
    leavers: drizzleLeavers(),
    people: drizzlePersonRepository(),
    reader: drizzlePersonReader(),
    calendars,
    clock: fixedClock(at),
    newId,
  })(ACME, '00000000-0000-4000-8000-0000000000c1');

const viewer = (accountId: string, ...roles: string[]): Viewer => ({
  accountId,
  roles: new Set(roles),
});
const hr = viewer('00000000-0000-4000-8000-0000000000ff', 'hr');
const on = (v: Viewer, personId: string) => ({
  tenantId: ACME,
  viewer: v,
  correlationId: '00000000-0000-4000-8000-0000000000c1',
  personId,
});

const ended = async (personId: string) =>
  [
    ...(await admin.execute(sql`
      SELECT envelope FROM people.outbox
       WHERE aggregate_id = ${personId} AND event_name = 'people.person.access_ended'
       ORDER BY created_at, event_id`)),
  ].map(
    (row) =>
      row['envelope'] as {
        effectiveFrom: string | null;
        actor: Record<string, unknown>;
        payload: Record<string, unknown>;
      },
  );

const endedAt = async (personId: string) => {
  const [row] = await admin.execute(
    sql`SELECT (extract(epoch FROM access_ended_at) * 1000)::bigint::text AS ms
          FROM people.person WHERE id = ${personId}::uuid`,
  );
  const ms = row?.['ms'];
  return typeof ms === 'string' ? new Date(Number(ms)).toISOString() : null;
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
    '20260926140000_people_visibility_rules.sql',
    '20260926180000_people_pending_change.sql',
    '20260922170000_people_person.sql',
    '20260924220000_people_access_end.sql',
    '20260924220200_people_employment_period.sql',
    '20260923110000_people_completeness.sql',
    '20260924150000_people_unique_hash.sql',
    '20260924170000_people_calendar.sql',
    '20260924170100_people_tenant_company.sql',
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

  await inTenant(ACME, ({ tx }) =>
    drizzleSchemaRepository().appendVersion(
      tx,
      ACME,
      versionOf(1, [
        define({ key: 'job_title' }),
        define({
          key: 'last_working_day',
          dataType: 'date',
          typeConfig: { kind: 'date' },
          effectiveDated: true,
        }),
      ]),
      [],
      '2026-09-01',
    ),
  );
  await admin.execute(sql`
    INSERT INTO people.person
      (tenant_id, id, status, identity_account_id, hire_date, last_working_day, legal_entity_id,
       given_name, family_name, work_email, schema_version)
    VALUES
      (${ACME}::uuid, ${KIRI}::uuid, 'terminated', ${KIRI_ACCOUNT}::uuid, '2026-01-05', '2026-09-30', ${NZ}::uuid,
       'Kiri', 'Ngata', 'kiri@acme.test', 1),
      (${ACME}::uuid, ${LUCY}::uuid, 'terminated', NULL, '2026-02-01', '2026-09-30', ${US}::uuid,
       'Lucy', 'Park', 'lucy@acme.test', 1),
      (${ACME}::uuid, ${MARCO}::uuid, 'notice', ${MARCO_ACCOUNT}::uuid, '2025-01-01', '2026-12-31', ${US}::uuid,
       'Marco', 'Rossi', 'marco@acme.test', 1),
      (${ACME}::uuid, ${ANA}::uuid, 'active', ${ANA_ACCOUNT}::uuid, '2025-01-01', NULL, ${US}::uuid,
       'Ana', 'Silva', 'ana@acme.test', 1),
      (${ACME}::uuid, ${AROHA}::uuid, 'notice', ${AROHA_ACCOUNT}::uuid, '2025-01-01', '2026-09-30', ${NZ}::uuid,
       'Aroha', 'Tane', 'aroha@acme.test', 1),
      (${ACME}::uuid, ${DEV}::uuid, 'notice', ${DEV_ACCOUNT}::uuid, '2025-01-01', '2026-09-30', ${US}::uuid,
       'Dev', 'Patel', 'dev@acme.test', 1),
      (${ACME}::uuid, ${ELI}::uuid, 'notice', ${ELI_ACCOUNT}::uuid, '2025-01-01', '2026-09-30', ${US}::uuid,
       'Eli', 'Stone', 'eli@acme.test', 1)
  `);
  // Their notices' last-working-day rows, which a correction supersedes.
  await admin.execute(sql`
    INSERT INTO people.person_attribute_history
      (id, tenant_id, person_id, attribute_key, value, effective_from, recorded_at, actor)
    VALUES
      (${AROHA_ROW}::uuid, ${ACME}::uuid, ${AROHA}::uuid, 'last_working_day', '"2026-09-30"'::jsonb,
       '2026-09-30', '2026-09-01', '{"kind":"system","process":"seed"}'::jsonb),
      (${ELI_ROW}::uuid, ${ACME}::uuid, ${ELI}::uuid, 'last_working_day', '"2026-09-30"'::jsonb,
       '2026-09-30', '2026-09-01', '{"kind":"system","process":"seed"}'::jsonb)
  `);
});

afterAll(async () => {
  for (const c of clients) await c.end();
  clients = [];
  await stopPg?.();
});

describe('the hourly job, on each leaver’s own calendar', () => {
  it('ends Auckland at its midnight while Los Angeles is still on its last day', async () => {
    const run = await jobAt('2026-09-30T11:30:00.000Z');
    // Kiri and Aroha (Auckland) end; Lucy and Dev (Los Angeles) wait.
    expect(run).toMatchObject({ ended: 2, waiting: 3, failed: [] });

    expect(await ended(KIRI)).toEqual([
      expect.objectContaining({
        effectiveFrom: '2026-10-01',
        actor: { kind: 'system', process: 'people-lifecycle' },
        payload: {
          personId: KIRI,
          identityAccountId: KIRI_ACCOUNT,
          lastWorkingDay: '2026-09-30',
          endedAt: '2026-09-30T11:00:00.000Z',
          trigger: 'last_working_day_ended',
        },
      }),
    ]);
    expect(await endedAt(KIRI)).toBe('2026-09-30T11:00:00.000Z');
    expect(await ended(LUCY)).toEqual([]);
  });

  it('ends Los Angeles at its own midnight, and nobody twice', async () => {
    expect(await jobAt('2026-10-01T07:30:00.000Z')).toMatchObject({ ended: 3, waiting: 0 });
    // Ended from its midnight, not from when the job got round to it; no account to name.
    expect((await ended(LUCY)).map((e) => e.payload)).toEqual([
      expect.objectContaining({ identityAccountId: null, endedAt: '2026-10-01T07:00:00.000Z' }),
    ]);

    expect(await jobAt('2026-10-01T09:00:00.000Z')).toMatchObject({ ended: 0, waiting: 0 });
    expect(await ended(KIRI)).toHaveLength(1);
    expect(await ended(LUCY)).toHaveLength(1);
  });
});

describe('a last day that ended with nobody confirming the termination', () => {
  it('ends access all the same, at each person’s own midnight, and leaves them on notice', async () => {
    // Both jobs above have run: Auckland's at 11:30 UTC on the 30th, Los Angeles's at 07:30 on the 1st.
    expect((await ended(AROHA)).map((e) => [e.effectiveFrom, e.payload])).toEqual([
      [
        '2026-10-01',
        {
          personId: AROHA,
          identityAccountId: AROHA_ACCOUNT,
          lastWorkingDay: '2026-09-30',
          endedAt: '2026-09-30T11:00:00.000Z',
          trigger: 'last_working_day_ended',
        },
      ],
    ]);
    expect((await ended(DEV)).map((e) => e.payload['endedAt'])).toEqual([
      '2026-10-01T07:00:00.000Z',
    ]);
    const rows = [
      ...(await admin.execute(
        sql`SELECT status FROM people.person WHERE id IN (${AROHA}::uuid, ${DEV}::uuid)`,
      )),
    ];
    // The termination is still HR's to confirm; only the access has gone.
    expect(rows.map((r) => r['status'])).toEqual(['notice', 'notice']);
  });

  it('raises nothing more when HR confirms the termination later', async () => {
    const confirmed = await inTenantResult(inTenant, ACME, (tx) =>
      accessAt('2026-10-02T20:00:00.000Z').terminate(tx, {
        ...on(hr, DEV),
        lastWorkingDay: '2026-09-30',
        reason: 'resigned',
        endAccessNow: true,
      }),
    );
    expect(confirmed.ok && confirmed.value.status).toBe('terminated');
    expect(await ended(DEV)).toHaveLength(1);
  });
});

describe('HR ending access at once', () => {
  const noon = '2026-09-30T19:00:00.000Z'; // noon in Los Angeles

  it('is HR’s alone, and only for somebody whose employment has ended', async () => {
    const colleague = await inTenantResult(inTenant, ACME, (tx) =>
      accessAt(noon).endAccess(tx, on(viewer(ANA_ACCOUNT), MARCO)),
    );
    expect(!colleague.ok && colleague.error.code).toBe('FORBIDDEN');
    const admin_ = await inTenantResult(inTenant, ACME, (tx) =>
      accessAt(noon).endAccess(
        tx,
        on(viewer('00000000-0000-4000-8000-0000000000fa', 'people_admin'), MARCO),
      ),
    );
    expect(!admin_.ok && admin_.error.code).toBe('FORBIDDEN');

    // Still on notice: still working, still signing in.
    const early = await inTenantResult(inTenant, ACME, (tx) =>
      accessAt(noon).endAccess(tx, on(hr, MARCO)),
    );
    expect(!early.ok && early.error.code).toBe('INVALID_TRANSITION');
    expect(await ended(MARCO)).toEqual([]);
  });

  it('ends it with the termination for a dismissal for cause, and a retry raises nothing more', async () => {
    const dismiss = () =>
      inTenantResult(inTenant, ACME, (tx) =>
        accessAt(noon).terminate(tx, {
          ...on(hr, MARCO),
          lastWorkingDay: '2026-09-30',
          reason: 'dismissed',
          eligibleForRehire: false,
          endAccessNow: true,
        }),
      );
    const done = await dismiss();
    expect(done.ok && done.value.status).toBe('terminated');
    expect((await dismiss()).ok).toBe(true);

    const raised = await ended(MARCO);
    expect(raised).toHaveLength(1);
    expect(raised[0]).toMatchObject({
      // Today on his calendar, from this instant: the audit names who did it.
      effectiveFrom: '2026-09-30',
      actor: { kind: 'user', userId: hr.accountId },
      payload: { identityAccountId: MARCO_ACCOUNT, endedAt: noon, trigger: 'ended_by_hr' },
    });

    // The job, later that night, finds nothing left to end for him.
    expect(await jobAt('2026-10-01T08:00:00.000Z')).toMatchObject({ ended: 0 });
    expect(await ended(MARCO)).toHaveLength(1);
  });

  it('answers a request to end access that has already ended with the record', async () => {
    const again = await inTenantResult(inTenant, ACME, (tx) =>
      accessAt(noon).endAccess(tx, on(hr, KIRI)),
    );
    expect(again.ok && again.value.status).toBe('terminated');
    expect(await ended(KIRI)).toHaveLength(1);
  });
});

describe('a notice’s last working day corrected forward after access ended (PEO-111)', () => {
  // 11:30 UTC on 1 October: the 1st has ended in Auckland (at 11:00 UTC) and
  // is still going in Los Angeles.
  const at = '2026-10-01T11:30:00.000Z';
  const correct = (supersedes: string) =>
    inTenantResult(inTenant, ACME, (tx) =>
      accessAt(at).correct(tx, {
        ...on(hr, supersedes === ELI_ROW ? ELI : AROHA),
        supersedes,
        value: '2026-10-01',
        reason: 'Handover extended by a day',
      }),
    );
  const restored = async (personId: string) =>
    [
      ...(await admin.execute(sql`
        SELECT envelope FROM people.outbox
         WHERE aggregate_id = ${personId} AND event_name = 'people.person.access_restored'`)),
    ].map((row) => row['envelope'] as { effectiveFrom: string; payload: Record<string, unknown> });

  it('gives Los Angeles its access back, in the correction’s transaction', async () => {
    expect((await correct(ELI_ROW)).ok).toBe(true);
    expect(await restored(ELI)).toEqual([
      expect.objectContaining({
        effectiveFrom: '2026-10-01',
        payload: {
          personId: ELI,
          identityAccountId: ELI_ACCOUNT,
          restoredAt: at,
          reason: 'last_working_day_corrected',
        },
      }),
    ]);
    expect(await endedAt(ELI)).toBeNull();
  });

  it('keeps Auckland’s ended: the corrected day has already ended there', async () => {
    expect((await correct(AROHA_ROW)).ok).toBe(true);
    expect(await restored(AROHA)).toEqual([]);
    expect(await endedAt(AROHA)).toBe('2026-09-30T11:00:00.000Z');
  });

  it('ends Los Angeles again when the new last day ends there', async () => {
    expect(await jobAt('2026-10-02T06:30:00.000Z')).toMatchObject({ ended: 0 });
    expect(await jobAt('2026-10-02T07:30:00.000Z')).toMatchObject({ ended: 1 });
    expect((await ended(ELI)).map((e) => e.payload['endedAt'])).toEqual([
      '2026-10-01T07:00:00.000Z',
      '2026-10-02T07:00:00.000Z',
    ]);
  });
});
