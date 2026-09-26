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
  drizzleLeavers,
  drizzlePersonReader,
  drizzleRelations,
  drizzleSchemaVersions,
} from '../../infrastructure/drizzle-person-reader.js';
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
import { define, versionOf } from './in-memory.js';
import { inTenantResult, personAccess } from './person-access.js';
import type { Viewer } from './ports.js';
import { endAccessDue } from './start.js';

/**
 * PEO-111: withdrawing notice, over Postgres as `svc_people`.
 *
 * Lucy (Los Angeles) resigned from parental leave with a last working day of
 * 30 September, then changed her mind. At 11:30 UTC on the 30th it is still
 * her last day, so HR may withdraw it and she goes back on leave; Kiri
 * (Auckland), on the same last day, has already finished it.
 */

const ACME = '00000000-0000-4000-8000-00000000000a';
const NZ = '00000000-0000-4000-8000-0000000000e1';
const US = '00000000-0000-4000-8000-0000000000e2';
const KIRI = '00000000-0000-4000-8000-0000000000a1';
const LUCY = '00000000-0000-4000-8000-0000000000a2';
const LUCY_ACCOUNT = '00000000-0000-4000-8000-0000000000b2';
const NOW = '2026-09-30T11:30:00.000Z';

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
const lastDay = define({
  key: 'last_working_day',
  dataType: 'date',
  typeConfig: { kind: 'date' },
  effectiveDated: true,
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
const at = (instant: string) => {
  const clock = fixedClock(instant);
  return personAccess({
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
};

const viewer = (accountId: string, ...roles: string[]): Viewer => ({
  accountId,
  roles: new Set(roles),
});
const hr = viewer('00000000-0000-4000-8000-0000000000ff', 'hr');
const on = (personId: string, v: Viewer = hr) => ({
  tenantId: ACME,
  viewer: v,
  correlationId: '00000000-0000-4000-8000-0000000000c1',
  personId,
});

const events = async (personId: string, name: string) =>
  [
    ...(await admin.execute(sql`
      SELECT envelope FROM people.outbox
       WHERE aggregate_id = ${personId} AND event_name = ${name}
       ORDER BY created_at, event_id`)),
  ].map(
    (row) =>
      row['envelope'] as {
        eventId: string;
        effectiveFrom: string | null;
        payload: Record<string, unknown>;
      },
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
      versionOf(1, [handover, lastDay]),
      [],
      '2026-01-01',
    ),
  );
  await admin.execute(sql`
    INSERT INTO people.person
      (tenant_id, id, status, identity_account_id, hire_date, legal_entity_id,
       given_name, family_name, work_email, schema_version)
    VALUES
      (${ACME}::uuid, ${KIRI}::uuid, 'active', NULL, '2025-01-06', ${NZ}::uuid,
       'Kiri', 'Ngata', 'kiri@acme.test', 1),
      (${ACME}::uuid, ${LUCY}::uuid, 'on_leave', ${LUCY_ACCOUNT}::uuid, '2025-01-06', ${US}::uuid,
       'Lucy', 'Park', 'lucy@acme.test', 1)
  `);
  // Both give notice ending on the 30th, a week before.
  for (const personId of [KIRI, LUCY]) {
    const given = await inTenantResult(inTenant, ACME, (tx) =>
      at('2026-09-23T12:00:00.000Z').giveNotice(tx, {
        ...on(personId),
        lastWorkingDay: '2026-09-30',
      }),
    );
    expect(given.ok).toBe(true);
  }
});

afterAll(async () => {
  for (const c of clients) await c.end();
  clients = [];
  await stopPg?.();
});

const withdraw = (personId: string, v: Viewer = hr) =>
  inTenantResult(inTenant, ACME, (tx) => at(NOW).withdrawNotice(tx, on(personId, v)));

describe('withdrawing notice', () => {
  it('is HR’s alone', async () => {
    for (const v of [
      viewer(LUCY_ACCOUNT),
      viewer('00000000-0000-4000-8000-0000000000fa', 'people_admin'),
    ]) {
      const refused = await withdraw(LUCY, v);
      expect(!refused.ok && refused.error.code).toBe('FORBIDDEN');
    }
  });

  it('sends Lucy back on leave, on her own day, superseding the notice’s last working day', async () => {
    const back = await withdraw(LUCY);
    expect(back.ok && back.value.status).toBe('on_leave');
    expect(back.ok && back.value.attributes['last_working_day']).toBeUndefined();

    const moves = await events(LUCY, 'people.person.status_changed');
    const withdrawn = moves.at(-1);
    expect(withdrawn).toMatchObject({
      // Still the 30th in Los Angeles.
      effectiveFrom: '2026-09-30',
      payload: { previous: 'notice', next: 'on_leave', reason: 'notice_withdrawn' },
    });

    const rows = [
      ...(await admin.execute(sql`
        SELECT id, value, effective_from::text AS effective_from, supersedes, event_id
          FROM people.person_attribute_history
         WHERE person_id = ${LUCY}::uuid AND attribute_key = 'last_working_day'
         ORDER BY recorded_at, id`)),
    ];
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({
      value: null,
      effective_from: '2026-09-30',
      supersedes: rows[0]?.['id'],
      event_id: withdrawn && (withdrawn as { eventId?: string }).eventId,
    });

    // As of her old last day, she no longer has one.
    const read = await inTenantResult(inTenant, ACME, (tx) =>
      at(NOW).read(tx, { ...on(LUCY), asOf: '2026-10-15' }),
    );
    expect(read.ok && read.value.attributes['last_working_day']).toBeUndefined();

    const [period] = [
      ...(await admin.execute(sql`
        SELECT last_working_day, notice_from FROM people.employment_period
         WHERE person_id = ${LUCY}::uuid`)),
    ];
    expect(period).toEqual({ last_working_day: null, notice_from: null });
  });

  it('re-judges completeness: what notice asked for is no longer missing', async () => {
    expect(await events(LUCY, 'people.person.profile_incomplete')).toHaveLength(1);
    expect(await events(LUCY, 'people.person.profile_completed')).toHaveLength(1);
  });

  it('leaves no access to end, however late the job runs', async () => {
    const run = await endAccessDue({
      inTenant,
      leavers: drizzleLeavers(),
      people: drizzlePersonRepository(),
      reader: drizzlePersonReader(),
      calendars,
      clock: fixedClock('2026-10-10T00:00:00.000Z'),
      newId,
    })(ACME, '00000000-0000-4000-8000-0000000000c1');
    // Only Kiri, still on notice with her last day ended (PEO-109); Lucy has none.
    expect(run).toMatchObject({ ended: 1 });
    expect(await events(LUCY, 'people.person.access_ended')).toEqual([]);
    expect(await events(KIRI, 'people.person.access_ended')).toHaveLength(1);
  });

  it('is refused once the last working day has ended where they work, and for somebody not on notice', async () => {
    // Auckland's 30th ended at 11:00 UTC.
    const late = await withdraw(KIRI);
    expect(!late.ok && late.error.code).toBe('LAST_DAY_ENDED');
    const [row] = await admin.execute(
      sql`SELECT status FROM people.person WHERE id = ${KIRI}::uuid`,
    );
    expect(row?.['status']).toBe('notice');

    const again = await withdraw(LUCY);
    expect(!again.ok && again.error.code).toBe('INVALID_TRANSITION');
  });
});
