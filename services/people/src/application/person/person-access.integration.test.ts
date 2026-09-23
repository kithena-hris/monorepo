import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fixedClock } from '@kithena/domain-kit';
import { startPostgres } from '@kithena/testing';

import { Person } from '../../domain/person/person.js';
import { drizzleCompletenessStore } from '../../infrastructure/drizzle-completeness-store.js';
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
import { inTenantResult, personAccess } from './person-access.js';
import type { Viewer } from './ports.js';

/**
 * The person use cases over the real adapters and a real Postgres, as
 * `svc_people` — which is `NOBYPASSRLS`, so every read here is the one RLS
 * lets through.
 */

const ACME = '00000000-0000-4000-8000-00000000000a';
const GLOBEX = '00000000-0000-4000-8000-00000000000b';
const ADA = '00000000-0000-4000-8000-0000000000a1';
const MARCO = '00000000-0000-4000-8000-0000000000a2';
const GRACE = '00000000-0000-4000-8000-0000000000a3';
const ADA_ACCOUNT = '00000000-0000-4000-8000-0000000000b1';
const MARCO_ACCOUNT = '00000000-0000-4000-8000-0000000000b2';
const GRACE_ACCOUNT = '00000000-0000-4000-8000-0000000000b3';

const salary = define({
  key: 'base_salary',
  dataType: 'money',
  typeConfig: { kind: 'money' },
  visibility: ['self', 'finance', 'hr'],
  ownership: ['hr'],
  effectiveDated: true,
  classification: {
    classification: 'confidential',
    piiKind: 'none',
    exportable: true,
    aiEligible: false,
  },
});
const title = define({
  key: 'job_title',
  visibility: ['self', 'manager_chain', 'hr'],
  effectiveDated: true,
});
const employeeNumber = define({
  key: 'employee_number',
  uniqueScope: 'tenant',
  visibility: ['hr'],
});
const iban = define({
  key: 'iban',
  dataType: 'bank_account',
  typeConfig: { kind: 'bank_account', country: 'DE' },
  encrypted: true,
  visibility: ['self', 'hr'],
  ownership: ['employee'],
  classification: {
    classification: 'confidential',
    piiKind: 'financial',
    exportable: true,
    aiEligible: false,
  },
});

let stopPg: (() => Promise<void>) | undefined;
let clients: ReturnType<typeof postgres>[] = [];
let admin: ReturnType<typeof drizzle>;
let inTenant: ReturnType<typeof tenantTransaction>;

let ids = 0;
const people = personAccess({
  people: drizzlePersonRepository(),
  reader: drizzlePersonReader(),
  schemas: drizzleSchemaVersions(),
  relations: drizzleRelations(),
  secrets: drizzleSecretStore(staticKeyRing([{ id: 'k1', key: randomBytes(32) }])),
  uniques: drizzleUniqueClaims(),
  clock: fixedClock('2026-09-22T09:00:00.000Z'),
  newId: () => {
    ids += 1;
    return `01890000-0000-7000-8000-${String(ids).padStart(12, '0')}`;
  },
});

const viewer = (accountId: string, ...roles: string[]): Viewer => ({
  accountId,
  roles: new Set(roles),
});
const hr = viewer('00000000-0000-4000-8000-0000000000ff', 'hr');
const asking = (v: Viewer, tenantId = ACME) => ({
  tenantId,
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
    '20260922170000_people_person.sql',
    '20260923110000_people_completeness.sql',
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

  // Grace manages Marco manages Ada: Grace is in Ada's chain, not her manager.
  const repo = drizzlePersonRepository();
  const seed = (id: string, account: string, managerId: string | null) =>
    inTenant(ACME, ({ tx }) =>
      repo.create(
        tx,
        Person.rehydrate({
          id,
          tenantId: ACME,
          status: 'active',
          identityAccountId: account,
          hireDate: '2026-01-01',
          lastWorkingDay: null,
        }),
        { managerId },
      ),
    );
  await seed(GRACE, GRACE_ACCOUNT, null);
  await seed(MARCO, MARCO_ACCOUNT, GRACE);
  await seed(ADA, ADA_ACCOUNT, MARCO);

  await inTenant(ACME, ({ tx }) =>
    drizzleSchemaRepository().appendVersion(
      tx,
      ACME,
      versionOf(1, [salary, title, employeeNumber, iban]),
      [],
      '2026-09-01',
    ),
  );
});

afterAll(async () => {
  for (const c of clients) await c.end();
  clients = [];
  await stopPg?.();
});

const write = (
  v: Viewer,
  personId: string,
  changes: Record<string, unknown>,
  effectiveFrom?: string,
) =>
  inTenantResult(inTenant, ACME, (tx) =>
    people.update(tx, {
      ...asking(v),
      personId,
      changes,
      ...(effectiveFrom ? { effectiveFrom } : {}),
    }),
  );
const read = (v: Viewer, personId: string, tenantId = ACME) =>
  inTenantResult(inTenant, tenantId, (tx) => people.read(tx, { ...asking(v, tenantId), personId }));

describe('a manager reading a report, over Postgres', () => {
  it('gets no salary key, and sees what the chain may see', async () => {
    const written = await write(hr, ADA, {
      base_salary: { amountMinor: 5_500_000, currency: 'EUR' },
      job_title: 'Engineer',
    });
    expect(written.ok).toBe(true);

    for (const account of [MARCO_ACCOUNT, GRACE_ACCOUNT]) {
      const seen = await read(viewer(account), ADA);
      expect(seen.ok).toBe(true);
      if (!seen.ok) continue;
      expect(seen.value.attributes).not.toHaveProperty('base_salary');
      expect(seen.value.attributes).toEqual({ job_title: 'Engineer' });
    }

    const own = await read(viewer(ADA_ACCOUNT), ADA);
    expect(own.ok && own.value.attributes['base_salary']).toEqual({
      amountMinor: 5_500_000,
      currency: 'EUR',
    });
  });

  it('is the same answer for a report of a report the other way round: Ada sees nothing of Marco', async () => {
    const seen = await read(viewer(ADA_ACCOUNT), MARCO);
    expect(seen.ok && seen.value.attributes).toEqual({});
  });

  it('finds nobody from another tenant', async () => {
    const seen = await read(hr, ADA, GLOBEX);
    expect(!seen.ok && seen.error.code).toBe('SCHEMA_NOT_PUBLISHED');
  });
});

describe('writes over Postgres', () => {
  it('stamps the version, keeps custom, and seals a secret out of the row and history', async () => {
    const result = await write(viewer(ADA_ACCOUNT), ADA, { iban: 'DE89370400440532013000' });
    expect(result.ok && result.value.attributes['iban']).toEqual({ last4: '3000' });

    const rows = await admin.execute(sql`
      SELECT schema_version, custom::text AS custom FROM people.person WHERE id = ${ADA}::uuid`);
    const row = [...rows][0];
    expect(row?.['schema_version']).toBe(1);
    expect(String(row?.['custom'])).not.toContain('DE89');

    const history = await admin.execute(sql`
      SELECT value FROM people.person_attribute_history WHERE attribute_key = 'iban'`);
    expect([...history][0]?.['value']).toBeNull();
  });

  it('rolls back a refused write, including the unique claim it already took', async () => {
    expect((await write(hr, MARCO, { employee_number: 'E-1' })).ok).toBe(true);

    const taken = await write(hr, ADA, { employee_number: 'e-1 ' });
    expect(!taken.ok && taken.error.code).toBe('UNIQUE_VALUE_TAKEN');

    // Claimed first, then refused on the invalid money: nothing may survive.
    const refused = await write(hr, ADA, {
      employee_number: 'E-2',
      base_salary: { amountMinor: 1.5, currency: 'EUR' },
    });
    expect(!refused.ok && refused.error.code).toBe('VALUE_INVALID');
    const claims = await admin.execute(sql`
      SELECT count(*)::int AS n FROM people.attribute_unique WHERE normalised_value = 'e-2'`);
    expect([...claims][0]?.['n']).toBe(0);
  });

  it('corrects by appending a row with supersedes; the original row is untouched', async () => {
    const before = await admin.execute(sql`
      SELECT id, value FROM people.person_attribute_history
       WHERE person_id = ${ADA}::uuid AND attribute_key = 'base_salary'`);
    const original = [...before][0];
    const originalId = String(original?.['id']);

    const corrected = await inTenantResult(inTenant, ACME, (tx) =>
      people.correct(tx, {
        ...asking(hr),
        personId: ADA,
        supersedes: originalId,
        value: { amountMinor: 5_600_000, currency: 'EUR' },
        reason: 'typo',
      }),
    );
    expect(corrected.ok).toBe(true);

    const after = await admin.execute(sql`
      SELECT id, value, supersedes FROM people.person_attribute_history
       WHERE person_id = ${ADA}::uuid AND attribute_key = 'base_salary' ORDER BY recorded_at, id`);
    const rows = [...after];
    expect(rows).toHaveLength(2);
    expect(rows[0]?.['value']).toEqual(original?.['value']);
    expect(rows[1]?.['supersedes']).toBe(originalId);

    const seen = await read(hr, ADA);
    expect(seen.ok && seen.value.attributes['base_salary']).toEqual({
      amountMinor: 5_600_000,
      currency: 'EUR',
    });

    const events = await admin.execute(sql`
      SELECT count(*)::int AS n FROM people.outbox WHERE event_name = 'people.person.attribute_corrected'`);
    expect([...events][0]?.['n']).toBe(1);
  });
});

describe('the lifecycle dates, hired and corrected over Postgres', () => {
  const INITECH = '00000000-0000-4000-8000-00000000000c';
  const LIN = '00000000-0000-4000-8000-0000000000a4';
  const dates = ['hire_date', 'last_working_day'].map((key) =>
    define({ key, dataType: 'date', typeConfig: { kind: 'date' } }),
  );
  const names = ['given_name', 'family_name', 'work_email'].map((key) => define({ key }));
  const lifecycleRows = async () => [
    ...(await admin.execute(sql`
      SELECT id, attribute_key, value #>> '{}' AS value, supersedes
        FROM people.person_attribute_history
       WHERE person_id = ${LIN}::uuid
       ORDER BY recorded_at, id`)),
  ];

  it('hires through PersonAccess.hire, and both dates correct against the rows the lifecycle wrote', async () => {
    await inTenant(INITECH, async ({ tx }) => {
      await drizzleSchemaRepository().appendVersion(
        tx,
        INITECH,
        versionOf(1, [...names, ...dates]),
        [],
        '2026-09-01',
      );
      await drizzlePersonRepository().create(
        tx,
        Person.rehydrate({
          id: LIN,
          tenantId: INITECH,
          status: 'provisional',
          identityAccountId: null,
          hireDate: null,
          lastWorkingDay: null,
        }),
        { givenName: 'Lin', familyName: 'Chen', workEmail: 'lin@initech.test' },
      );
    });

    const hired = await inTenantResult(inTenant, INITECH, (tx) =>
      people.hire(tx, { ...asking(hr, INITECH), personId: LIN, hireDate: '2026-03-01' }),
    );
    expect(hired.ok && hired.value.status).toBe('active');
    const [hireRow] = await lifecycleRows();
    expect(hireRow).toMatchObject({ attribute_key: 'hire_date', value: '2026-03-01' });

    // Notice through the aggregate and the repository: no transport gives notice yet.
    await inTenant(INITECH, async ({ tx }) => {
      const snapshot = await drizzlePersonRepository().load(tx, INITECH, LIN);
      if (!snapshot) throw new Error('Lin is missing');
      const lin = Person.rehydrate(snapshot);
      const given = lin.giveNotice('2026-12-31', {
        clock: fixedClock('2026-09-22T09:00:00.000Z'),
        newEventId: () => {
          ids += 1;
          return `01890000-0000-7000-8000-${String(ids).padStart(12, '0')}`;
        },
        actor: { kind: 'system', process: 'integration-test' },
        correlationId: '00000000-0000-4000-8000-0000000000c1',
        causationId: null,
      });
      if (!given.ok) throw new Error(given.error.message);
      await drizzlePersonRepository().save(tx, lin);
    });
    const noticeRow = (await lifecycleRows()).find((r) => r['attribute_key'] === 'last_working_day');
    expect(noticeRow).toMatchObject({ value: '2026-12-31' });

    const correct = (supersedes: unknown, value: string) =>
      inTenantResult(inTenant, INITECH, (tx) =>
        people.correct(tx, {
          ...asking(hr, INITECH),
          personId: LIN,
          supersedes: String(supersedes),
          value,
          reason: 'entered wrongly',
        }),
      );
    expect((await correct(hireRow?.['id'], '2026-02-01')).ok).toBe(true);
    expect((await correct(noticeRow?.['id'], '2026-11-30')).ok).toBe(true);

    const [row] = [
      ...(await admin.execute(sql`
        SELECT hire_date::text AS hire_date, last_working_day::text AS last_working_day, custom
          FROM people.person WHERE id = ${LIN}::uuid`)),
    ];
    expect(row).toMatchObject({ hire_date: '2026-02-01', last_working_day: '2026-11-30', custom: {} });
    const corrections = (await lifecycleRows()).filter((r) => r['supersedes'] !== null);
    expect(corrections.map((r) => r['supersedes'])).toEqual([hireRow?.['id'], noticeRow?.['id']]);
  });

  /** A hired person in INITECH, and the history row their hire wrote. */
  async function hired(id: string, account: string | null, hireDate: string): Promise<string> {
    await inTenant(INITECH, ({ tx }) =>
      drizzlePersonRepository().create(
        tx,
        Person.rehydrate({
          id,
          tenantId: INITECH,
          status: 'provisional',
          identityAccountId: account,
          hireDate: null,
          lastWorkingDay: null,
        }),
        { givenName: 'Sam', familyName: 'Ortiz', workEmail: `${id.slice(-4)}@initech.test` },
      ),
    );
    const done = await inTenantResult(inTenant, INITECH, (tx) =>
      people.hire(tx, { ...asking(hr, INITECH), personId: id, hireDate }),
    );
    if (!done.ok) throw new Error(done.error.message);
    const [row] = await admin.execute(sql`
      SELECT id FROM people.person_attribute_history
       WHERE person_id = ${id}::uuid AND attribute_key = 'hire_date'`);
    return String(row?.['id']);
  }

  const correctOn = (personId: string, supersedes: string, value: string) =>
    inTenantResult(inTenant, INITECH, (tx) =>
      people.correct(tx, {
        ...asking(hr, INITECH),
        personId,
        supersedes,
        value,
        reason: 'entered wrongly',
      }),
    );

  const eventsOf = async (personId: string, name: string) => [
    ...(await admin.execute(sql`
      SELECT event_id, envelope FROM people.outbox
       WHERE aggregate_id = ${personId} AND event_name = ${name}
       ORDER BY created_at, event_id`)),
  ];

  it('returns an active person to pre-hire when the start is corrected into the future, and tells identity', async () => {
    const SAM = '00000000-0000-4000-8000-0000000000a5';
    const hireRow = await hired(SAM, '00000000-0000-4000-8000-0000000000b5', '2026-09-01');

    const corrected = await correctOn(SAM, hireRow, '2026-10-15');
    expect(corrected.ok).toBe(true);

    const seen = await inTenantResult(inTenant, INITECH, (tx) =>
      people.read(tx, { ...asking(hr, INITECH), personId: SAM }),
    );
    expect(seen.ok && seen.value.status).toBe('pre_hire');

    const [correction] = await eventsOf(SAM, 'people.person.attribute_corrected');
    const moves = await eventsOf(SAM, 'people.person.status_changed');
    expect(moves.map((m) => (m['envelope'] as { payload: unknown }).payload)).toMatchObject([
      { previous: 'provisional', next: 'active', reason: 'hired' },
      { previous: 'active', next: 'pre_hire', reason: 'corrected' },
    ]);
    expect(moves[1]?.['envelope']).toMatchObject({
      effectiveFrom: '2026-09-01',
      causationId: correction?.['event_id'],
    });
    expect(correction?.['envelope']).toMatchObject({ payload: { supersedes: hireRow } });

    // Identity gates enrolment on the start date it caches, so it hears the new one.
    const facts = await eventsOf(SAM, 'people.person.identity_facts_changed');
    expect(facts.at(-1)?.['envelope']).toMatchObject({ payload: { employmentStart: '2026-10-15' } });
  });

  it('keeps a person on notice whose last day is corrected into the past, and asks HR to confirm', async () => {
    const KIM = '00000000-0000-4000-8000-0000000000a6';
    await hired(KIM, null, '2026-01-01');
    await inTenant(INITECH, async ({ tx }) => {
      const snapshot = await drizzlePersonRepository().load(tx, INITECH, KIM);
      if (!snapshot) throw new Error('Kim is missing');
      const kim = Person.rehydrate(snapshot);
      const given = kim.giveNotice('2026-12-31', systemContext());
      if (!given.ok) throw new Error(given.error.message);
      await drizzlePersonRepository().save(tx, kim);
    });
    const lastDayRow = async () => {
      const [row] = await admin.execute(sql`
        SELECT id FROM people.person_attribute_history
         WHERE person_id = ${KIM}::uuid AND attribute_key = 'last_working_day'
         ORDER BY recorded_at DESC, id DESC LIMIT 1`);
      return String(row?.['id']);
    };
    const grid = () =>
      inTenant(INITECH, ({ tx }) => drizzleCompletenessStore().staffGrid(tx, INITECH, '2026-09-22'));
    expect(await grid()).toEqual([]);

    const before = (await eventsOf(KIM, 'people.person.status_changed')).length;
    expect((await correctOn(KIM, await lastDayRow(), '2026-09-15')).ok).toBe(true);

    const [row] = await admin.execute(sql`SELECT status FROM people.person WHERE id = ${KIM}::uuid`);
    expect(row?.['status']).toBe('notice');
    expect(await eventsOf(KIM, 'people.person.status_changed')).toHaveLength(before);
    expect(await eventsOf(KIM, 'people.person.terminated')).toEqual([]);
    expect(await eventsOf(KIM, 'people.person.attribute_corrected')).toHaveLength(1);
    expect(await grid()).toEqual([
      { task: 'confirm_termination', key: 'last_working_day', personIds: [KIM] },
    ]);

    // Corrected forward, the task is gone; back again, and HR terminating closes it.
    expect((await correctOn(KIM, await lastDayRow(), '2026-10-31')).ok).toBe(true);
    expect(await grid()).toEqual([]);
    expect((await correctOn(KIM, await lastDayRow(), '2026-09-15')).ok).toBe(true);
    expect(await grid()).toHaveLength(1);
    await inTenant(INITECH, async ({ tx }) => {
      const snapshot = await drizzlePersonRepository().load(tx, INITECH, KIM);
      if (!snapshot) throw new Error('Kim is missing');
      const kim = Person.rehydrate(snapshot);
      const ended = kim.terminate('2026-09-15', systemContext());
      if (!ended.ok) throw new Error(ended.error.message);
      await drizzlePersonRepository().save(tx, kim);
    });
    expect(await grid()).toEqual([]);
  });
});

/** The context for a transition no transport offers yet, driven through the aggregate. */
function systemContext() {
  return {
    clock: fixedClock('2026-09-22T09:00:00.000Z'),
    newEventId: () => {
      ids += 1;
      return `01890000-0000-7000-8000-${String(ids).padStart(12, '0')}`;
    },
    actor: { kind: 'system' as const, process: 'integration-test' },
    correlationId: '00000000-0000-4000-8000-0000000000c1',
    causationId: null,
  };
}
