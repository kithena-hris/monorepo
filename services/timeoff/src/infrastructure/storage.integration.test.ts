import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { readdir, readFile } from 'node:fs/promises';
import { startPostgres } from '@kithena/testing';

import * as t from './tables.js';

/**
 * Time Off's storage (TOF-029 – TOF-033), against every Time Off migration
 * and nothing else.
 *
 * Each ticket's section adds its tables to `TABLES` and a seed to `seeds`.
 * Seeds write as `svc_timeoff` through the Drizzle definitions, so a column
 * named one way in a migration and another in `tables.ts` fails here, and
 * the last section proves a connection with no tenant sees none of it.
 */

const TENANT_A = '00000000-0000-4000-8000-00000000000a';
const tenantId = TENANT_A;
const ADAM = '00000000-0000-4000-8000-0000000000ad';
const MARCO = '00000000-0000-4000-8000-0000000000aa';
const MIGRATIONS_DIR = new URL('../../../../migrations/', import.meta.url);

type Seed = (tx: PostgresJsDatabase) => Promise<unknown>;
const TABLES: string[] = [];
const seeds: Seed[] = [];

let stopPg: (() => Promise<void>) | undefined;
let adminClient: ReturnType<typeof postgres> | undefined;
let serviceClient: ReturnType<typeof postgres> | undefined;
let admin: PostgresJsDatabase;
let asTimeoff: PostgresJsDatabase;

const id = (n: number): string => `01890000-0000-7000-8000-${String(n).padStart(12, '0')}`;

beforeAll(async () => {
  const pg = await startPostgres();
  stopPg = pg.stop;
  adminClient = postgres(pg.url, { max: 1, onnotice: () => {} });
  admin = drizzle(adminClient);

  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.includes('_timeoff_')).toSorted();
  // In order, one after the other: each builds on the last.
  for (const file of files) {
    // oxlint-disable-next-line no-await-in-loop
    await admin.execute(sql.raw(await readFile(new URL(file, MIGRATIONS_DIR), 'utf8')));
  }
  await admin.execute(sql`ALTER ROLE svc_timeoff LOGIN PASSWORD 'svc_timeoff'`);

  const asService = new URL(pg.url);
  asService.username = 'svc_timeoff';
  asService.password = 'svc_timeoff';
  serviceClient = postgres(asService.toString(), { max: 4 });
  asTimeoff = drizzle(serviceClient);

  await inTenant(TENANT_A, async (tx) => {
    // oxlint-disable-next-line no-await-in-loop
    for (const seed of seeds) await seed(tx);
  });
});

afterAll(async () => {
  await serviceClient?.end();
  await adminClient?.end();
  await stopPg?.();
});

function inTenant<T>(tenant: string, fn: (tx: PostgresJsDatabase) => Promise<T>): Promise<T> {
  return asTimeoff.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenant}, true)`);
    return fn(tx);
  });
}

/* ------------------------------------------------------------- TOF-029 -- */

TABLES.push('member');
seeds.push(async (tx) => {
  const row = { tenantId, lastEventId: id(1), lastEffectiveFrom: '2026-01-01' };
  await tx.insert(t.member).values([
    { ...row, personId: MARCO, displayName: 'Marco Ruiz' },
    {
      ...row,
      personId: ADAM,
      displayName: 'Adam Novak',
      managerPersonId: MARCO,
      workPattern: [1, 2, 3, 4, 5],
    },
  ]);
});

/** The consumer's upsert: writes only when the event moves the row forward. */
const applyToRavi = (eventId: string, effectiveFrom: string, teamKey: string) =>
  inTenant(TENANT_A, (tx) =>
    tx.execute(sql`
      INSERT INTO timeoff.member
        (tenant_id, person_id, display_name, team_key, last_event_id, last_effective_from)
      VALUES (${TENANT_A}, ${id(99)}, 'Ravi Shah', ${teamKey}, ${eventId}, ${effectiveFrom})
      ON CONFLICT (tenant_id, person_id) DO UPDATE SET
        team_key            = EXCLUDED.team_key,
        last_event_id       = EXCLUDED.last_event_id,
        last_effective_from = EXCLUDED.last_effective_from
      WHERE (member.last_effective_from, member.last_event_id)
          < (EXCLUDED.last_effective_from, EXCLUDED.last_event_id)`),
  );

const ravi = async () => [
  ...(await inTenant(TENANT_A, (tx) =>
    tx.execute(sql`SELECT team_key FROM timeoff.member WHERE person_id = ${id(99)}`),
  )),
];

describe('the member projection', () => {
  it('applies the same event twice and keeps one row', async () => {
    await applyToRavi(id(200), '2026-10-01', 'platform');
    await applyToRavi(id(200), '2026-10-01', 'platform');
    expect(await ravi()).toEqual([{ team_key: 'platform' }]);
  });

  it('does not let an older event undo a newer one', async () => {
    await applyToRavi(id(201), '2026-11-01', 'design');
    await applyToRavi(id(199), '2026-09-01', 'sales');
    expect(await ravi()).toEqual([{ team_key: 'design' }]);
  });
});

/* ------------------------------------------------------------- TOF-030 -- */

/** The SQLSTATE a statement failed with, or `resolved`. */
async function sqlState(work: Promise<unknown>): Promise<unknown> {
  try {
    await work;
  } catch (e) {
    return (e as { cause?: { code?: string } }).cause?.code ?? (e as { code?: string }).code;
  }
  return 'resolved';
}

const INSUFFICIENT_PRIVILEGE = '42501';
const RESTRICT_VIOLATION = '23001';

TABLES.push('leave_type', 'policy', 'policy_version', 'ledger_entry');
seeds.push(async (tx) => {
  await tx.insert(t.leaveType).values({
    tenantId,
    key: 'vacation',
    name: { default: 'Vacation' },
    category: 'annual_leave',
    colorToken: 'chart-1',
    icon: 'sun',
    tracked: true,
    paid: 'paid',
    visibility: 'type',
  });
  await tx.insert(t.policy).values({ tenantId, id: id(10), leaveTypeKey: 'vacation' });
  await tx.insert(t.policyVersion).values({
    tenantId,
    policyId: id(10),
    version: 1,
    status: 'published',
    definition: { leaveTypeKey: 'vacation' },
    effectiveFrom: '2026-01-01',
    publishedAt: '2026-01-01T09:00:00Z',
  });
  await tx.insert(t.ledgerEntry).values({
    tenantId,
    id: id(30),
    personId: ADAM,
    leaveTypeKey: 'vacation',
    kind: 'accrual',
    amount: '2.083',
    unit: 'day',
    effectiveOn: '2026-10-01',
    occurredAt: '2026-10-01T00:00:00Z',
    policyVersion: 1,
  });
});

describe('the ledger', () => {
  it('cannot be updated by svc_timeoff', async () => {
    expect(
      await sqlState(
        inTenant(TENANT_A, (tx) => tx.execute(sql`UPDATE timeoff.ledger_entry SET amount = 0`)),
      ),
    ).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it('cannot be deleted from by svc_timeoff', async () => {
    expect(
      await sqlState(inTenant(TENANT_A, (tx) => tx.execute(sql`DELETE FROM timeoff.ledger_entry`))),
    ).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it('gives an amount back with the three places it went in with', async () => {
    const rows = await inTenant(TENANT_A, (tx) =>
      tx.select({ amount: t.ledgerEntry.amount }).from(t.ledgerEntry),
    );
    expect(rows).toContainEqual({ amount: '2.083' });
  });
});

describe('a published policy version', () => {
  it('refuses any change', async () => {
    expect(
      await sqlState(
        inTenant(TENANT_A, (tx) =>
          tx.execute(sql`UPDATE timeoff.policy_version SET definition = '{}'::jsonb`),
        ),
      ),
    ).toBe(RESTRICT_VIOLATION);
  });
});

/* ------------------------------------------------------------- TOF-031 -- */

const EXCLUSION_VIOLATION = '23P01';

/** A request for Adam over `days`, a multirange literal. */
const requestRow = (n: number, days: string, status = 'pending') => ({
  tenantId,
  id: id(n),
  personId: ADAM,
  leaveTypeKey: 'vacation',
  status,
  days,
  workingDays: '1.000',
  requestedAt: '2026-10-03T09:00:00Z',
});

TABLES.push('request', 'request_decision');
seeds.push(async (tx) => {
  await tx
    .insert(t.request)
    .values({ ...requestRow(20, '{[2026-10-19,2026-10-23]}', 'approved'), workingDays: '5.000' });
  await tx.insert(t.requestDecision).values({
    tenantId,
    id: id(21),
    requestId: id(20),
    outcome: 'approved',
    role: 'manager',
    decidedBy: MARCO,
    decidedAt: '2026-10-02T09:00:00Z',
  });
  await tx.insert(t.ledgerEntry).values({
    tenantId,
    id: id(22),
    personId: ADAM,
    leaveTypeKey: 'vacation',
    kind: 'booking',
    amount: '-5.000',
    unit: 'day',
    effectiveOn: '2026-10-19',
    occurredAt: '2026-10-01T09:00:00Z',
    requestId: id(20),
  });
});

describe('requests', () => {
  it('keeps exactly one of two overlapping live requests sent at once', async () => {
    const first = inTenant(TENANT_A, async (tx) => {
      await tx.insert(t.request).values(requestRow(300, '{[2026-11-02,2026-11-06]}'));
      // Hold the row uncommitted while the second arrives.
      await tx.execute(sql`SELECT pg_sleep(0.5)`);
    });
    const second = (async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
      return sqlState(
        inTenant(TENANT_A, (tx) =>
          tx.insert(t.request).values(requestRow(301, '{[2026-11-05,2026-11-09]}')),
        ),
      );
    })();

    const [, refused] = await Promise.all([first, second]);
    expect(refused).toBe(EXCLUSION_VIOLATION);
    const rows = await inTenant(TENANT_A, (tx) =>
      tx.execute(sql`SELECT id FROM timeoff.request WHERE id IN (${id(300)}, ${id(301)})`),
    );
    expect([...rows]).toEqual([{ id: id(300) }]);
  });

  it('lets a declined request share days with a live one', async () => {
    expect(
      await sqlState(
        inTenant(TENANT_A, (tx) =>
          tx.insert(t.request).values(requestRow(302, '{[2026-10-21,2026-10-21]}', 'declined')),
        ),
      ),
    ).toBe('resolved');
  });

  it('leaves the day between two runs of a swapped request bookable', async () => {
    await inTenant(TENANT_A, (tx) =>
      tx
        .insert(t.request)
        .values(requestRow(303, '{[2026-12-07,2026-12-08],[2026-12-10,2026-12-11]}')),
    );
    expect(
      await sqlState(
        inTenant(TENANT_A, (tx) =>
          tx.insert(t.request).values(requestRow(304, '{[2026-12-09,2026-12-09]}')),
        ),
      ),
    ).toBe('resolved');
  });
});

/* -------------------------------------------------------- every table -- */

describe('every Time Off table', () => {
  it('has row level security enabled and forced', async () => {
    const rows = await admin.execute(sql`
      SELECT relname::text AS name FROM pg_class
       WHERE relnamespace = 'timeoff'::regnamespace AND relkind = 'r'
         AND relrowsecurity AND relforcerowsecurity`);
    expect([...rows].map((r) => r['name'])).toEqual(expect.arrayContaining(TABLES));
  });

  it.each(TABLES)('%s shows a connection with no tenant set nothing', async (table) => {
    const count = sql.raw(`SELECT count(*)::int AS n FROM timeoff.${table}`);
    const seeded = await inTenant(TENANT_A, (tx) => tx.execute(count));
    expect([...seeded][0]?.['n']).toBeGreaterThan(0);

    const unset = await asTimeoff.execute(count);
    expect([...unset][0]?.['n']).toBe(0);
  });
});
