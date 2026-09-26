import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { readFile } from 'node:fs/promises';
import { fixedClock } from '@kithena/domain-kit';
import { startPostgres } from '@kithena/testing';

import type { TenantCalendar } from '../../domain/org/calendar.js';
import { drizzlePersonRepository } from '../../infrastructure/drizzle-person-repository.js';
import {
  drizzleArrivals,
  drizzlePersonReader,
} from '../../infrastructure/drizzle-person-reader.js';
import { tenantTransaction } from '../../infrastructure/unit-of-work.js';
import { fixedCalendars } from '../org/org.js';
import { startArrivals } from './start.js';

/**
 * PEO-104: a pre-hire starts on their start date, on their own calendar.
 *
 * Both start on 1 October. At 12:00 UTC on 30 September it is already the 1st
 * in Auckland and still the 30th in Los Angeles, so one starts and the other
 * waits until their own midnight — and a re-run starts nobody twice.
 */

const ACME = '00000000-0000-4000-8000-00000000000a';
const NZ = '00000000-0000-4000-8000-0000000000e1';
const US = '00000000-0000-4000-8000-0000000000e2';
const KIRI = '00000000-0000-4000-8000-0000000000a1';
const LUCY = '00000000-0000-4000-8000-0000000000a2';
const LATER = '00000000-0000-4000-8000-0000000000a3';
const KIRI_ACCOUNT = '00000000-0000-4000-8000-0000000000b1';

const calendar: TenantCalendar = {
  defaultZone: 'Europe/Madrid',
  entities: new Map([
    [NZ, { id: NZ, name: 'Acme NZ', country: 'NZ', timeZone: 'Pacific/Auckland' }],
    [US, { id: US, name: 'Acme US', country: 'US', timeZone: 'America/Los_Angeles' }],
  ]),
  locations: new Map(),
};

let stopPg: (() => Promise<void>) | undefined;
let clients: ReturnType<typeof postgres>[] = [];
let admin: ReturnType<typeof drizzle>;
let inTenant: ReturnType<typeof tenantTransaction>;

let ids = 0;
const newId = () => {
  ids += 1;
  return `01890000-0000-7000-8000-${String(ids).padStart(12, '0')}`;
};

const runAt = (at: string) =>
  startArrivals({
    inTenant,
    arrivals: drizzleArrivals(),
    people: drizzlePersonRepository(),
    reader: drizzlePersonReader(),
    calendars: fixedCalendars(calendar),
    clock: fixedClock(at),
    newId,
  })(ACME, '00000000-0000-4000-8000-0000000000c1');

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
    '20260922170000_people_person.sql',
    '20260924220000_people_access_end.sql',
    '20260926143000_people_duplicates.sql',
    '20260924220200_people_employment_period.sql',
    '20260924150000_people_unique_hash.sql',
    '20260923110000_people_completeness.sql',
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

  await admin.execute(sql`
    INSERT INTO people.person
      (tenant_id, id, status, identity_account_id, hire_date, legal_entity_id, given_name, family_name, work_email)
    VALUES
      (${ACME}::uuid, ${KIRI}::uuid, 'pre_hire', ${KIRI_ACCOUNT}::uuid, '2026-10-01', ${NZ}::uuid, 'Kiri', 'Ngata', 'kiri@acme.test'),
      (${ACME}::uuid, ${LUCY}::uuid, 'pre_hire', NULL, '2026-10-01', ${US}::uuid, 'Lucy', 'Park', 'lucy@acme.test'),
      (${ACME}::uuid, ${LATER}::uuid, 'pre_hire', NULL, '2026-11-02', ${NZ}::uuid, 'Tama', 'Reti', 'tama@acme.test')
  `);
});

afterAll(async () => {
  for (const c of clients) await c.end();
  clients = [];
  await stopPg?.();
});

const statuses = async (): Promise<Record<string, string>> =>
  Object.fromEntries(
    [...(await admin.execute(sql`SELECT id, status FROM people.person ORDER BY id`))].map((r) => [
      String(r['id']),
      String(r['status']),
    ]),
  );

const events = async (aggregateId: string) =>
  [
    ...(await admin.execute(sql`
      SELECT event_name, envelope FROM people.outbox
       WHERE aggregate_id = ${aggregateId} ORDER BY event_id`)),
  ].map((r) => ({
    name: r['event_name'],
    effectiveFrom: (r['envelope'] as { effectiveFrom: string | null }).effectiveFrom,
    payload: (r['envelope'] as { payload: Record<string, unknown> }).payload,
  }));

describe('starting pre-hires on their own day', () => {
  it('starts Auckland on its 1 October while Los Angeles is still on the 30th', async () => {
    const run = await runAt('2026-09-30T12:00:00.000Z');
    expect(run).toMatchObject({ started: 1, waiting: 1, failed: [] });
    expect(await statuses()).toEqual({ [KIRI]: 'active', [LUCY]: 'pre_hire', [LATER]: 'pre_hire' });

    // The same events a start raises by hand: the move, effective from the
    // start date, and identity's copy of the start date for a linked person.
    const raised = await events(KIRI);
    expect(raised).toHaveLength(2);
    expect(raised).toMatchObject([
      {
        name: 'people.person.status_changed',
        effectiveFrom: '2026-10-01',
        payload: { previous: 'pre_hire', next: 'active', reason: 'started' },
      },
      {
        name: 'people.person.identity_facts_changed',
        effectiveFrom: '2026-10-01',
        payload: { identityAccountId: KIRI_ACCOUNT, employmentStart: '2026-10-01' },
      },
    ]);
  });

  it('starts Los Angeles at its own midnight, and nobody twice', async () => {
    const run = await runAt('2026-10-01T07:30:00.000Z');
    expect(run).toMatchObject({ started: 1, waiting: 0 });
    expect(await statuses()).toEqual({ [KIRI]: 'active', [LUCY]: 'active', [LATER]: 'pre_hire' });
    expect((await events(LUCY)).map((e) => e.name)).toEqual(['people.person.status_changed']);

    expect(await runAt('2026-10-01T09:00:00.000Z')).toMatchObject({ started: 0, waiting: 0 });
    expect(await events(KIRI)).toHaveLength(2);
  });
});
