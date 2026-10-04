import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { startPostgres } from '@kithena/testing';

import { tenantTransaction } from '../../infrastructure/unit-of-work.js';
import { drizzleApprovalFlagStore } from './approval-flag-store.js';
import { drizzlePendingChangeStore } from './pending-store.js';

/**
 * The approval checks' tables against a real database (design AI7, AI8):
 * switches, marks, questions and the decided flags each stay in their tenant;
 * a team's raises are read from history as its chain stands; the band in
 * force is the latest recording; the last 90 days count what was flagged.
 */

const ACME = '00000000-0000-4000-8000-00000000000a';
const GLOBEX = '00000000-0000-4000-8000-00000000000b';
const TOM = '00000000-0000-4000-8000-0000000000a1';
const ANA = '00000000-0000-4000-8000-0000000000a2';
const LEO = '00000000-0000-4000-8000-0000000000a3';
const NORA = '00000000-0000-4000-8000-0000000000b1';
const SOFIA = '00000000-0000-4000-8000-0000000000b2';
const CHANGE = '00000000-0000-4000-9000-000000000001';
const OTHER = '00000000-0000-4000-9000-000000000002';

let stopPg: (() => Promise<void>) | undefined;
let adminClient: ReturnType<typeof postgres> | undefined;
let serviceClient: ReturnType<typeof postgres> | undefined;
let admin: PostgresJsDatabase;
let inTenant: ReturnType<typeof tenantTransaction>;
const store = drizzleApprovalFlagStore();
const changes = drizzlePendingChangeStore({
  seal: () => ({ ciphertext: '', keyId: 'k' }),
  open: () => '',
});

const migration = (file: string): Promise<string> =>
  readFile(new URL(`../../../../../migrations/${file}`, import.meta.url), 'utf8');

beforeAll(async () => {
  const pg = await startPostgres();
  stopPg = pg.stop;
  adminClient = postgres(pg.url, { max: 1 });
  admin = drizzle(adminClient);
  for (const file of [
    '20260821120000_tenant_registry.sql',
    '20260922140000_people_bootstrap.sql',
    '20260922160000_people_registry.sql',
    '20261005120000_people_section_names.sql',
    '20260926140000_people_visibility_rules.sql',
    '20260926180000_people_pending_change.sql',
    '20260926230000_people_pending_change_decided_as.sql',
    '20260922170000_people_person.sql',
    '20260924220000_people_access_end.sql',
    '20260926143000_people_duplicates.sql',
    '20260924220200_people_employment_period.sql',
    '20260926190000_people_pay.sql',
    '20261001170000_people_approval_flags.sql',
  ]) {
    await admin.execute(sql.raw(await migration(file)));
  }
  await admin.execute(sql`ALTER ROLE svc_people LOGIN PASSWORD 'svc_people'`);
  const asService = new URL(pg.url);
  asService.username = 'svc_people';
  asService.password = 'svc_people';
  serviceClient = postgres(asService.toString(), { max: 4 });
  inTenant = tenantTransaction(drizzle(serviceClient));

  for (const [id, team] of [
    [TOM, 'sales'],
    [ANA, 'sales'],
    [LEO, 'engineering'],
  ] as const) {
    await admin.execute(sql`
      INSERT INTO people.person (id, tenant_id, status, given_name, family_name, custom)
      VALUES (${id}::uuid, ${ACME}::uuid, 'active', 'A', 'B',
              ${JSON.stringify({ department: team })}::jsonb)`);
  }
  const history = (id: string, person: string, minor: number, from: string, supersedes?: string) =>
    admin.execute(sql`
      INSERT INTO people.person_attribute_history
             (id, tenant_id, person_id, attribute_key, value, effective_from, recorded_at, actor, supersedes)
      VALUES (${id}::uuid, ${ACME}::uuid, ${person}::uuid, 'base_salary',
              ${JSON.stringify({ amountMinor: minor, currency: 'EUR' })}::jsonb, ${from}::date,
              ${`${from}T09:00:00Z`}::timestamptz, '{"kind":"system","process":"test"}'::jsonb,
              ${supersedes ?? null}::uuid)`);
  // Ana: 50k in 2025, 52k from March, a typo of 60k from June corrected to 54k.
  await history('00000000-0000-7000-8000-000000000001', ANA, 5_000_000, '2025-01-01');
  await history('00000000-0000-7000-8000-000000000002', ANA, 5_200_000, '2026-03-01');
  await history('00000000-0000-7000-8000-000000000003', ANA, 6_000_000, '2026-06-01');
  await history(
    '00000000-0000-7000-8000-000000000004',
    ANA,
    5_400_000,
    '2026-06-01',
    '00000000-0000-7000-8000-000000000003',
  );
  // Leo is in another team; Tom's own history is not his team's.
  await history('00000000-0000-7000-8000-000000000005', LEO, 5_000_000, '2025-01-01');
  await history('00000000-0000-7000-8000-000000000006', LEO, 9_000_000, '2026-02-01');
  await history('00000000-0000-7000-8000-000000000007', TOM, 6_000_000, '2025-01-01');
  await history('00000000-0000-7000-8000-000000000008', TOM, 6_100_000, '2026-02-01');
  await admin.execute(sql`
    INSERT INTO people.person_attribute_history
           (id, tenant_id, person_id, attribute_key, value, effective_from, recorded_at, actor)
    VALUES ('00000000-0000-7000-8000-000000000009', ${ACME}::uuid, ${TOM}::uuid, 'home_address',
            '"Calle 1"'::jsonb, '2026-09-20', '2026-09-20T10:00:00Z', '{"kind":"system","process":"test"}'::jsonb)`);

  for (const [id, at] of [
    ['00000000-0000-4000-8000-0000000000c1', '2026-01-01'],
    ['00000000-0000-4000-8000-0000000000c2', '2026-07-01'],
  ] as const) {
    await admin.execute(sql`
      INSERT INTO people.pay_band (tenant_id, id, grade, currency, minimum, midpoint, maximum,
                                   effective_from, recorded_at, recorded_by)
      VALUES (${ACME}::uuid, ${id}::uuid, 'L3', 'EUR', ${at === '2026-01-01' ? 60000 : 62000},
              70000, 78000, ${at}::date, now(), ${SOFIA}::uuid)`);
  }

  for (const [id, state] of [
    [CHANGE, 'pending'],
    [OTHER, 'pending'],
  ] as const) {
    await admin.execute(sql`
      INSERT INTO people.pending_change (tenant_id, id, person_id, attribute_key, kind, sealed, value,
                                         effective_from, requested_by, requested_at, expires_at, state)
      VALUES (${ACME}::uuid, ${id}::uuid, ${TOM}::uuid, 'base_salary', 'value', false,
              '{"amountMinor":8400000,"currency":"EUR"}'::jsonb, '2026-10-01', ${NORA}::uuid,
              '2026-09-22T09:00:00Z', '2026-09-29T09:00:00Z', ${state})`);
  }
});

afterAll(async () => {
  await serviceClient?.end();
  await adminClient?.end();
  await stopPg?.();
});

describe('what the checks read', () => {
  it('reads a team’s raises this year as the chain stands, nobody else’s', async () => {
    const raises = await inTenant(ACME, ({ tx }) =>
      store.teamRaises(tx, ACME, {
        teamKey: 'department',
        team: 'sales',
        payKey: 'base_salary',
        except: TOM,
        from: '2026-01-01',
        until: '2026-12-31',
      }),
    );
    expect(raises.map((r) => [r.before.amountMinor, r.after.amountMinor])).toEqual([
      ['5000000', '5200000'],
      ['5200000', '5400000'],
    ]);
  });

  it('reads the band in force on a day, in minor units', async () => {
    const band = await inTenant(ACME, ({ tx }) =>
      store.band(tx, ACME, { grade: 'L3', currency: 'EUR', day: '2026-10-01' }),
    );
    expect(band).toEqual({ minimumMinor: '6200000', maximumMinor: '7800000' });
    expect(
      await inTenant(ACME, ({ tx }) =>
        store.band(tx, ACME, { grade: 'L3', currency: 'EUR', day: '2026-02-01' }),
      ),
    ).toEqual({ minimumMinor: '6000000', maximumMinor: '7800000' });
    expect(
      await inTenant(ACME, ({ tx }) =>
        store.band(tx, ACME, { grade: 'L4', currency: 'EUR', day: '2026-10-01' }),
      ),
    ).toBeNull();
  });

  it('reads when an address was recorded', async () => {
    const changed = await inTenant(ACME, ({ tx }) =>
      store.changedAt(tx, ACME, {
        personId: TOM,
        keys: ['home_address', 'work_email'],
        since: '2026-09-08T00:00:00Z',
      }),
    );
    expect(changed).toEqual([{ key: 'home_address', at: '2026-09-20T10:00:00.000Z' }]);
  });
});

describe('what People keeps about the checks', () => {
  it('keeps switches, marks, questions and decided flags in their tenant', async () => {
    await inTenant(ACME, async ({ tx }) => {
      await store.setSwitch(tx, ACME, {
        code: 'raise',
        on: false,
        by: SOFIA,
        at: '2026-09-22T10:00:00Z',
      });
      await store.setSwitch(tx, ACME, {
        code: 'raise',
        on: true,
        by: SOFIA,
        at: '2026-09-22T10:01:00Z',
      });
      await store.setSwitch(tx, ACME, {
        code: 'unusual_time',
        on: true,
        by: SOFIA,
        at: '2026-09-22T10:01:00Z',
      });
      await store.mark(
        tx,
        ACME,
        CHANGE,
        [{ code: 'raise', requestedBy: NORA, magnitude: '38', at: '2026-09-22T10:02:00.000Z' }],
        SOFIA,
      );
      await store.ask(tx, ACME, {
        id: '00000000-0000-4000-9000-0000000000f1',
        changeId: OTHER,
        askedBy: SOFIA,
        askedAt: '2026-09-22T10:03:00.000Z',
        question: 'Promotion?',
        answer: null,
        answeredAt: null,
      });
    });
    const read = await inTenant(ACME, async ({ tx }) => ({
      switches: [...(await store.switches(tx, ACME))].toSorted(),
      marks: await store.marks(tx, ACME, '2026-09-01T00:00:00Z'),
      questions: await store.questions(tx, ACME, [OTHER]),
    }));
    expect(read.switches).toEqual([
      ['raise', true],
      ['unusual_time', true],
    ]);
    expect(read.marks).toEqual([
      { code: 'raise', requestedBy: NORA, magnitude: '38.00', at: '2026-09-22T10:02:00.000Z' },
    ]);
    expect(read.questions.map((q) => q.question)).toEqual(['Promotion?']);
    const elsewhere = await inTenant(GLOBEX, async ({ tx }) => ({
      switches: (await store.switches(tx, GLOBEX)).size,
      marks: (await store.marks(tx, GLOBEX, '2026-01-01T00:00:00Z')).length,
      questions: (await store.questions(tx, GLOBEX, [OTHER])).length,
    }));
    expect(elsewhere).toEqual({ switches: 0, marks: 0, questions: 0 });
  });

  it('answers a question once', async () => {
    const id = '00000000-0000-4000-9000-0000000000f2';
    const asked = {
      id,
      changeId: OTHER,
      askedBy: SOFIA,
      askedAt: '2026-09-22T10:03:00.000Z',
      question: 'Why now?',
      answer: null,
      answeredAt: null,
    };
    await inTenant(ACME, ({ tx }) => store.ask(tx, ACME, asked));
    const answer = { ...asked, answer: 'Payroll closes', answeredAt: '2026-09-22T11:00:00.000Z' };
    expect(await inTenant(ACME, ({ tx }) => store.answer(tx, ACME, answer))).toBe(true);
    expect(
      await inTenant(ACME, ({ tx }) => store.answer(tx, ACME, { ...answer, answer: 'Again' })),
    ).toBe(false);
    expect((await inTenant(ACME, ({ tx }) => store.question(tx, ACME, id)))?.answer).toBe(
      'Payroll closes',
    );
  });

  it('records what flagged a decided change, and counts the last 90 days', async () => {
    await admin.execute(sql`
      UPDATE people.pending_change
         SET state = 'rejected', decided_by = ${SOFIA}::uuid, decided_at = '2026-09-23T09:00:00Z'
       WHERE id = ${OTHER}::uuid`);
    await inTenant(ACME, ({ tx }) => store.recordDecided(tx, ACME, OTHER, ['raise', 'band']));
    const decided = await inTenant(ACME, ({ tx }) =>
      changes.decided(tx, ACME, {
        since: '2026-09-01T00:00:00Z',
        until: '2026-09-25T00:00:00Z',
        limit: 10,
      }),
    );
    expect(decided.map((c) => [c.approval.id, c.flags])).toEqual([[OTHER, ['raise', 'band']]]);
    // Past its deadline, the one still pending lapsed: Decided lists it first, newest.
    const later = await inTenant(ACME, ({ tx }) =>
      changes.decided(tx, ACME, {
        since: '2026-09-01T00:00:00Z',
        until: '2026-10-01T00:00:00Z',
        limit: 10,
      }),
    );
    expect(later.map((c) => [c.approval.id, c.approval.state])).toEqual([
      [CHANGE, 'pending'],
      [OTHER, 'rejected'],
    ]);
    const stats = await inTenant(ACME, ({ tx }) => store.stats(tx, ACME, '2026-07-01T00:00:00Z'));
    // OTHER flagged and rejected; CHANGE marked not unusual.
    expect(stats).toEqual({ flagged: 2, rejected: 1, marked: 1 });
  });
});
