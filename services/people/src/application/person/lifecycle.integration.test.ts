import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fixedClock } from '@kithena/domain-kit';
import { startPostgres } from '@kithena/testing';

import type { TenantCalendar } from '../../domain/org/calendar.js';
import { drizzleCompletenessStore } from '../../infrastructure/drizzle-completeness-store.js';
import { drizzlePersonRepository } from '../../infrastructure/drizzle-person-repository.js';
import {
  drizzlePersonReader,
  drizzleRelations,
  drizzleSchemaVersions,
} from '../../infrastructure/drizzle-person-reader.js';
import { drizzleRetentionStore } from '../../infrastructure/drizzle-retention-store.js';
import {
  drizzlePeopleFacts,
  drizzleSchemaRepository,
} from '../../infrastructure/drizzle-schema-repository.js';
import { staticKeyRing } from '../../infrastructure/envelope.js';
import { drizzleSecretStore } from '../../infrastructure/secret-store.js';
import { drizzleUniqueClaims } from '../../infrastructure/unique.js';
import { tenantTransaction } from '../../infrastructure/unit-of-work.js';
import { recomputePerson } from '../completeness/recompute.js';
import { fixedCalendars } from '../org/org.js';
import { reportStore } from '../import/fixture.js';
import { anonymiseDue } from '../retention/anonymise.js';
import { define, versionOf } from './in-memory.js';
import { inTenantResult, personAccess } from './person-access.js';
import type { Viewer } from './ports.js';

/**
 * PEO-108: notice, termination, leave and discarding through `PersonAccess`,
 * over Postgres as `svc_people`.
 *
 * The clock is noon UTC on 30 September: already 1 October for Kiri in
 * Auckland, still 30 September for Lucy in Los Angeles. Every "today" below is
 * the person's own.
 */

const ACME = '00000000-0000-4000-8000-00000000000a';
const NZ = '00000000-0000-4000-8000-0000000000e1';
const US = '00000000-0000-4000-8000-0000000000e2';
const KIRI = '00000000-0000-4000-8000-0000000000a1';
const LUCY = '00000000-0000-4000-8000-0000000000a2';
const MARCO = '00000000-0000-4000-8000-0000000000a3';
const DRAFT = '00000000-0000-4000-8000-0000000000a4';
const LUCY_ACCOUNT = '00000000-0000-4000-8000-0000000000b2';
const MARCO_ACCOUNT = '00000000-0000-4000-8000-0000000000b3';
const NOW = '2026-09-30T12:00:00.000Z';

const calendar: TenantCalendar = {
  defaultZone: 'Europe/Madrid',
  entities: new Map([
    [NZ, { id: NZ, name: 'Acme NZ', country: 'NZ', timeZone: 'Pacific/Auckland' }],
    [US, { id: US, name: 'Acme US', country: 'US', timeZone: 'America/Los_Angeles' }],
  ]),
  locations: new Map(),
};
const calendars = fixedCalendars(calendar);

/** Asked for only while somebody is on notice, so the move shows in completeness. */
const handover = define({
  key: 'handover_owner',
  requiredness: {
    mode: 'conditional',
    when: { combine: 'all', clauses: [{ operand: 'status', in: ['notice'] }] },
  },
});
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
const clock = fixedClock(NOW);
const people = personAccess({
  calendars,
  people: drizzlePersonRepository(),
  reader: drizzlePersonReader(),
  schemas: drizzleSchemaVersions(),
  relations: drizzleRelations(),
  secrets: drizzleSecretStore(ring),
  uniques: drizzleUniqueClaims(ring),
  clock,
  newId,
  completeness: recomputePerson({
    schema: drizzleSchemaRepository(),
    people: drizzlePeopleFacts(),
    store: drizzleCompletenessStore(),
    clock,
    newEventId: newId,
    calendars,
  }),
});

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
const as = <T>(fn: (tx: Parameters<Parameters<typeof inTenant>[1]>[0]['tx']) => Promise<T>) =>
  inTenant(ACME, ({ tx }) => fn(tx));

const events = async (personId: string, name?: string) =>
  [
    ...(await admin.execute(sql`
      SELECT event_name, envelope FROM people.outbox
       WHERE aggregate_id = ${personId}
       ORDER BY created_at, event_id`)),
  ]
    .filter((row) => name === undefined || row['event_name'] === name)
    .map(
      (row) =>
        row['envelope'] as { effectiveFrom: string | null; payload: Record<string, unknown> },
    );

const lastDayRows = async (personId: string) => [
  ...(await admin.execute(sql`
    SELECT value #>> '{}' AS value, effective_from::text AS effective_from
      FROM people.person_attribute_history
     WHERE person_id = ${personId}::uuid AND attribute_key = 'last_working_day'
     ORDER BY recorded_at, id`)),
];

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
    '20260923140000_people_retention.sql',
    '20260924150000_people_unique_hash.sql',
    '20260924170000_people_calendar.sql',
    '20260924170100_people_tenant_company.sql',
    '20260924320000_people_effective_through.sql',
    '20260924330000_people_identifier_review.sql',
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

  await as((tx) =>
    drizzleSchemaRepository().appendVersion(
      tx,
      ACME,
      versionOf(1, [handover, phone]),
      [],
      '2026-09-01',
    ),
  );
  // Marco manages Lucy. Draft is a provisional record created by mistake.
  await admin.execute(sql`
    INSERT INTO people.person
      (tenant_id, id, status, identity_account_id, hire_date, legal_entity_id, manager_id,
       given_name, family_name, work_email, custom, schema_version)
    VALUES
      (${ACME}::uuid, ${KIRI}::uuid, 'active', NULL, '2026-01-05', ${NZ}::uuid, NULL,
       'Kiri', 'Ngata', 'kiri@acme.test', ${JSON.stringify({ phone: '+64 21 000 000' })}::jsonb, 1),
      (${ACME}::uuid, ${MARCO}::uuid, 'active', ${MARCO_ACCOUNT}::uuid, '2025-01-01', ${US}::uuid, NULL,
       'Marco', 'Rossi', 'marco@acme.test', '{}'::jsonb, 1),
      (${ACME}::uuid, ${LUCY}::uuid, 'active', ${LUCY_ACCOUNT}::uuid, '2026-02-01', ${US}::uuid, ${MARCO}::uuid,
       'Lucy', 'Park', 'lucy@acme.test', '{}'::jsonb, 1),
      (${ACME}::uuid, ${DRAFT}::uuid, 'provisional', NULL, NULL, NULL, NULL,
       NULL, NULL, NULL, '{}'::jsonb, 1)
  `);
});

afterAll(async () => {
  for (const c of clients) await c.end();
  clients = [];
  await stopPg?.();
});

describe('who may move a person', () => {
  it('is HR alone: a manager, the person themselves and a people_admin are refused, and nothing is written', async () => {
    const before = (await events(LUCY)).length;
    const attempts = [
      inTenantResult(inTenant, ACME, (tx) =>
        people.terminate(tx, {
          ...on(viewer(MARCO_ACCOUNT), LUCY),
          lastWorkingDay: '2026-09-30',
          reason: 'dismissed',
        }),
      ),
      inTenantResult(inTenant, ACME, (tx) =>
        people.giveNotice(tx, { ...on(viewer(LUCY_ACCOUNT), LUCY), lastWorkingDay: '2026-12-31' }),
      ),
      inTenantResult(inTenant, ACME, (tx) =>
        people.startLeave(
          tx,
          on(viewer('00000000-0000-4000-8000-0000000000fa', 'people_admin'), LUCY),
        ),
      ),
    ];
    for (const attempt of await Promise.all(attempts)) {
      expect(!attempt.ok && attempt.error.code).toBe('FORBIDDEN');
    }
    expect(await events(LUCY)).toHaveLength(before);
    const [row] = await admin.execute(
      sql`SELECT status FROM people.person WHERE id = ${LUCY}::uuid`,
    );
    expect(row?.['status']).toBe('active');
  });
});

describe('leave, on the person’s own day', () => {
  it('starts and ends leave dated where each person works, and a retried start raises nothing', async () => {
    const away = await inTenantResult(inTenant, ACME, (tx) => people.startLeave(tx, on(hr, KIRI)));
    expect(away.ok && away.value.status).toBe('on_leave');
    const again = await inTenantResult(inTenant, ACME, (tx) => people.startLeave(tx, on(hr, KIRI)));
    expect(again.ok && again.value.status).toBe('on_leave');
    const back = await inTenantResult(inTenant, ACME, (tx) => people.endLeave(tx, on(hr, KIRI)));
    expect(back.ok && back.value.status).toBe('active');

    expect(
      (await events(KIRI, 'people.person.status_changed')).map((e) => [
        e.payload['reason'],
        e.effectiveFrom,
      ]),
    ).toEqual([
      ['leave_started', '2026-10-01'],
      ['leave_ended', '2026-10-01'],
    ]);

    // In Los Angeles it is still the 30th.
    expect(
      (await inTenantResult(inTenant, ACME, (tx) => people.startLeave(tx, on(hr, LUCY)))).ok,
    ).toBe(true);
    expect((await events(LUCY, 'people.person.status_changed')).at(-1)?.effectiveFrom).toBe(
      '2026-09-30',
    );
    expect(
      (await inTenantResult(inTenant, ACME, (tx) => people.endLeave(tx, on(hr, LUCY)))).ok,
    ).toBe(true);
  });

  it('refuses to bring back somebody who was never away', async () => {
    const refused = await inTenantResult(inTenant, ACME, (tx) => people.endLeave(tx, on(hr, KIRI)));
    expect(!refused.ok && refused.error.code).toBe('INVALID_TRANSITION');
  });
});

describe('notice, then termination', () => {
  const grid = () => as((tx) => drizzleCompletenessStore().staffGrid(tx, ACME, '2026-09-30'));

  it('gives notice with its dated row, asks for what notice requires, and answers a retry with no second event', async () => {
    const notice = () =>
      inTenantResult(inTenant, ACME, (tx) =>
        people.giveNotice(tx, {
          ...on(hr, LUCY),
          lastWorkingDay: '2026-09-29',
          reason: 'dismissed',
        }),
      );
    const given = await notice();
    expect(given.ok && given.value.status).toBe('notice');
    expect((await notice()).ok).toBe(true);

    const moves = await events(LUCY, 'people.person.status_changed');
    const onNotice = moves.filter((e) => e.payload['next'] === 'notice');
    expect(onNotice).toHaveLength(1);
    expect(onNotice[0]).toMatchObject({
      effectiveFrom: '2026-09-30',
      payload: { previous: 'active', reason: 'dismissed' },
    });
    expect(await lastDayRows(LUCY)).toEqual([
      { value: '2026-09-29', effective_from: '2026-09-29' },
    ]);

    // PEO-102: a field required on notice is now missing, and HR's grid says
    // the last day has passed.
    expect(await events(LUCY, 'people.person.profile_incomplete')).toHaveLength(1);
    expect(await grid()).toContainEqual({
      task: 'confirm_termination',
      key: 'last_working_day',
      personIds: [LUCY],
    });

    // A different last day is a correction, not a retry.
    const moved = await inTenantResult(inTenant, ACME, (tx) =>
      people.giveNotice(tx, { ...on(hr, LUCY), lastWorkingDay: '2026-10-15' }),
    );
    expect(!moved.ok && moved.error.code).toBe('INVALID_TRANSITION');
  });

  it('refuses a last day that has not come on their calendar, then terminates and closes the grid task', async () => {
    const terminate = (lastWorkingDay: string) =>
      inTenantResult(inTenant, ACME, (tx) =>
        people.terminate(tx, {
          ...on(hr, LUCY),
          lastWorkingDay,
          reason: 'dismissed',
          note: 'Role made redundant',
          eligibleForRehire: false,
        }),
      );
    // The 1st has begun in Auckland, not in Los Angeles.
    const early = await terminate('2026-10-01');
    expect(!early.ok && early.error.code).toBe('LAST_DAY_NOT_REACHED');

    const ended = await terminate('2026-09-29');
    expect(ended.ok && ended.value.status).toBe('terminated');
    expect((await terminate('2026-09-29')).ok).toBe(true);

    const all = await events(LUCY);
    const [moved] = all.filter((e) => e.payload['next'] === 'terminated');
    expect(moved).toMatchObject({
      effectiveFrom: '2026-09-29',
      payload: { previous: 'notice', reason: 'dismissed' },
    });
    expect(await events(LUCY, 'people.person.terminated')).toEqual([
      expect.objectContaining({
        effectiveFrom: '2026-09-29',
        payload: {
          personId: LUCY,
          lastWorkingDay: '2026-09-29',
          reason: 'Role made redundant',
          eligibleForRehire: false,
        },
      }),
    ]);
    // Notice recorded the date; the termination did not move it, so no second row.
    expect(await lastDayRows(LUCY)).toHaveLength(1);
    expect(await grid()).toEqual([]);
    // Terminated asks nothing of notice any more.
    expect(await events(LUCY, 'people.person.profile_completed')).toHaveLength(1);
    // Nothing identity caches moved.
    expect(await events(LUCY, 'people.person.identity_facts_changed')).toEqual([]);

    const otherDay = await terminate('2026-09-28');
    expect(!otherDay.ok && otherDay.error.code).toBe('INVALID_TRANSITION');
  });

  it('terminates straight from active on a last day that has begun where they work, with its row', async () => {
    const ended = await inTenantResult(inTenant, ACME, (tx) =>
      people.terminate(tx, { ...on(hr, KIRI), lastWorkingDay: '2026-10-01', reason: 'resigned' }),
    );
    expect(ended.ok && ended.value.status).toBe('terminated');
    expect(await lastDayRows(KIRI)).toEqual([
      { value: '2026-10-01', effective_from: '2026-10-01' },
    ]);
    const [row] = await admin.execute(
      sql`SELECT last_working_day::text AS d FROM people.person WHERE id = ${KIRI}::uuid`,
    );
    expect(row?.['d']).toBe('2026-10-01');
  });

  it('starts the retention clock from the last working day, on their calendar (§12)', async () => {
    const anonymiseAt = (at: string) =>
      as((tx) =>
        anonymiseDue({
          calendars,
          store: drizzleRetentionStore(),
          clock: fixedClock(at),
          newEventId: newId,
          reports: reportStore(fixedClock(at)),
        })(tx, {
          tenantId: ACME,
          personId: KIRI,
          actor: { kind: 'system', process: 'retention' },
          mode: { kind: 'automated' },
          correlationId: '00000000-0000-4000-8000-0000000000c1',
        }),
      );
    // Six months after 1 October is 1 April: it has not begun in Auckland at
    // 10:00 UTC on 31 March, and has at 12:00.
    const early = await anonymiseAt('2027-03-31T10:00:00.000Z');
    expect(early.ok && early.value.cleared).toEqual([]);
    const due = await anonymiseAt('2027-03-31T12:00:00.000Z');
    expect(due.ok && due.value.cleared).toEqual(['phone']);
  });
});

describe('discarding', () => {
  it('discards a provisional record, and a retry is answered with no second event', async () => {
    const discarded = await inTenantResult(inTenant, ACME, (tx) =>
      people.discard(tx, on(hr, DRAFT)),
    );
    expect(discarded.ok && discarded.value.status).toBe('discarded');
    expect(
      (await inTenantResult(inTenant, ACME, (tx) => people.discard(tx, on(hr, DRAFT)))).ok,
    ).toBe(true);
    expect(
      (await events(DRAFT, 'people.person.status_changed')).map((e) => e.payload['next']),
    ).toEqual(['discarded']);
  });

  it('refuses anybody who was ever employed', async () => {
    const refused = await inTenantResult(inTenant, ACME, (tx) => people.discard(tx, on(hr, KIRI)));
    expect(!refused.ok && refused.error.code).toBe('INVALID_TRANSITION');
  });
});
