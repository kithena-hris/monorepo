import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { readFile } from 'node:fs/promises';
import { fixedClock } from '@kithena/domain-kit';
import { startPostgres } from '@kithena/testing';

import { Person, type EventContext, type HireFacts } from '../domain/person/person.js';
import { drizzlePersonRepository } from './drizzle-person-repository.js';
import { tenantTransaction } from './unit-of-work.js';

/**
 * The repository, and the one guarantee it exists to keep.
 *
 * **No path writes a person row without its event in the same transaction.**
 * Debezium tails the WAL, so an event exists if and only if the row committed
 * — and the test that matters is the rollback: a write that fails halfway must
 * leave neither the row nor the event, because half of it is a consumer acting
 * on a hire that never happened.
 */

const ACME = '00000000-0000-4000-8000-00000000000a';
const GLOBEX = '00000000-0000-4000-8000-00000000000b';
const ADA = '00000000-0000-4000-8000-0000000000a1';
const ACCOUNT = '00000000-0000-4000-8000-0000000000b1';

let stopPg: (() => Promise<void>) | undefined;
let adminClient: ReturnType<typeof postgres> | undefined;
let serviceClient: ReturnType<typeof postgres> | undefined;
let admin: PostgresJsDatabase;
let inTenant: ReturnType<typeof tenantTransaction>;

const repository = drizzlePersonRepository();

const migration = (file: string): Promise<string> =>
  readFile(new URL(`../../../../migrations/${file}`, import.meta.url), 'utf8');

/*
 * Deterministic, and counted across the whole file rather than per context.
 *
 * Production mints a uuidv7 per event. A counter that restarted with each
 * context would hand the second transaction the same id as the first, which
 * the outbox's primary key correctly refuses — a failure about the test
 * harness wearing the costume of a failure about the repository.
 */
let events = 0;

function context(at = '2026-09-22T09:00:00.000Z'): EventContext {
  return {
    clock: fixedClock(at),
    newEventId: () => {
      events += 1;
      return `01890000-0000-7000-8000-${String(events).padStart(12, '0')}`;
    },
    actor: { kind: 'system', process: 'integration-test' },
    correlationId: '00000000-0000-4000-8000-0000000000c1',
    causationId: null,
  };
}

const HIRED: HireFacts = {
  legalEntityId: null,
  name: { given: 'Ada', family: 'Lovelace', preferred: null },
  workEmail: 'ada@acme.test',
  managerId: null,
  orgUnitId: null,
  schemaVersion: 1,
  sourceOfRecord: 'own',
};

const provisional = (id = ADA, tenantId = ACME) =>
  Person.rehydrate({
    id,
    tenantId,
    status: 'provisional',
    identityAccountId: ACCOUNT,
    hireDate: null,
    lastWorkingDay: null,
  });

beforeAll(async () => {
  const pg = await startPostgres();
  stopPg = pg.stop;

  adminClient = postgres(pg.url, { max: 1 });
  admin = drizzle(adminClient);

  for (const file of [
    '20260821120000_tenant_registry.sql',
    '20260922140000_people_bootstrap.sql',
    '20260922160000_people_registry.sql',
    '20260922170000_people_person.sql',
    '20260924170000_people_calendar.sql',
    '20260924170100_people_tenant_company.sql',
  ]) {
    await admin.execute(sql.raw(await migration(file)));
  }

  await admin.execute(sql`ALTER ROLE svc_people LOGIN PASSWORD 'svc_people'`);

  const asService = new URL(pg.url);
  asService.username = 'svc_people';
  asService.password = 'svc_people';
  serviceClient = postgres(asService.toString(), { max: 4 });
  inTenant = tenantTransaction(drizzle(serviceClient));
});

afterAll(async () => {
  await serviceClient?.end();
  await adminClient?.end();
  await stopPg?.();
});

beforeEach(async () => {
  await admin.execute(
    sql`ALTER TABLE people.person_attribute_history DISABLE TRIGGER history_is_append_only`,
  );
  await admin.execute(sql`DELETE FROM people.person_attribute_history`);
  await admin.execute(
    sql`ALTER TABLE people.person_attribute_history ENABLE TRIGGER history_is_append_only`,
  );
  await admin.execute(sql`DELETE FROM people.outbox`);
  await admin.execute(sql`DELETE FROM people.person`);
});

async function counts(): Promise<{ people: number; events: number; history: number }> {
  const rows = await admin.execute(sql`
    SELECT (SELECT count(*) FROM people.person)::int                   AS people,
           (SELECT count(*) FROM people.outbox)::int                   AS events,
           (SELECT count(*) FROM people.person_attribute_history)::int AS history
  `);
  const row = [...rows][0];
  return {
    people: Number(row?.['people']),
    events: Number(row?.['events']),
    history: Number(row?.['history']),
  };
}

describe('a write and its event', () => {
  it('commit together', async () => {
    await inTenant(ACME, async ({ tx }) => {
      const person = provisional();
      person.hire('2026-09-01', HIRED, context(), 'Etc/UTC');
      await repository.create(tx, person, { givenName: 'Ada', familyName: 'Lovelace' });
    });

    expect(await counts()).toMatchObject({ people: 1, events: 2 });

    const rows = await admin.execute(
      sql`SELECT event_name, aggregate_id FROM people.outbox ORDER BY event_id`,
    );
    expect([...rows].map((r) => r['event_name'])).toEqual([
      'people.person.status_changed',
      'people.person.hired',
    ]);
    expect([...rows][0]).toMatchObject({ aggregate_id: ADA });
  });

  it('roll back together, leaving neither the row nor the event', async () => {
    // The test the ticket names. Half of this is a consumer acting on a hire
    // that never happened, and no compensating message ever un-hires anybody.
    await expect(
      inTenant(ACME, async ({ tx }) => {
        const person = provisional();
        person.hire('2026-09-01', HIRED, context(), 'Etc/UTC');
        await repository.create(tx, person, { givenName: 'Ada', familyName: 'Lovelace' });

        // Something later in the same unit of work fails. A validation, a
        // constraint, a second aggregate that refused.
        throw new Error('the rest of the use case refused');
      }),
    ).rejects.toThrow('the rest of the use case refused');

    expect(await counts()).toEqual({ people: 0, events: 0, history: 0 });
  });

  it('roll back together when the database is what refuses', async () => {
    await expect(
      inTenant(ACME, async ({ tx }) => {
        const first = provisional();
        first.hire('2026-09-01', HIRED, context(), 'Etc/UTC');
        await repository.create(tx, first, { employeeNumber: 'E-1' });

        // Same employee number, same tenant. The partial unique index refuses
        // the second insert, and the first must not survive it.
        const second = Person.rehydrate({
          id: '00000000-0000-4000-8000-0000000000a2',
          tenantId: ACME,
          status: 'provisional',
          identityAccountId: null,
          hireDate: null,
          lastWorkingDay: null,
        });
        second.hire('2026-09-01', HIRED, context(), 'Etc/UTC');
        await repository.create(tx, second, { employeeNumber: 'E-1' });
      }),
    ).rejects.toThrow();

    expect(await counts()).toEqual({ people: 0, events: 0, history: 0 });
  });

  it('writes history, the row and the event as one', async () => {
    await inTenant(ACME, async ({ tx }) => {
      const person = provisional();
      person.hire('2026-09-01', HIRED, context(), 'Etc/UTC');
      await repository.create(tx, person);
    });

    await inTenant(ACME, async ({ tx }) => {
      const snapshot = await repository.load(tx, ACME, ADA);
      expect(snapshot).not.toBeNull();
      if (!snapshot) return;

      const person = Person.rehydrate(snapshot);
      person.giveNotice('2026-12-31', context('2026-10-01T09:00:00.000Z'), 'Etc/UTC');

      await repository.save(tx, person, {
        history: [
          {
            id: '01890000-0000-7000-8000-0000000000f1',
            attributeKey: 'base_salary',
            value: 5500000,
            effectiveFrom: '2026-01-01',
            recordedAt: '2026-10-01T09:00:00.000Z',
            actor: { kind: 'system', process: 'integration-test' },
            supersedes: null,
            eventId: null,
          },
        ],
      });
    });

    // The salary row, and the lifecycle's own: the hire date and the last working day.
    expect(await counts()).toMatchObject({ people: 1, history: 3 });
    const keys = await admin.execute(
      sql`SELECT attribute_key FROM people.person_attribute_history ORDER BY attribute_key`,
    );
    expect([...keys].map((r) => r['attribute_key'])).toEqual([
      'base_salary',
      'hire_date',
      'last_working_day',
    ]);
  });
});

describe('the aggregate and the row', () => {
  beforeEach(async () => {
    await inTenant(ACME, async ({ tx }) => {
      const person = provisional();
      person.hire('2026-09-01', HIRED, context(), 'Etc/UTC');
      await repository.create(tx, person, { givenName: 'Ada', familyName: 'Lovelace' });
    });
  });

  it('round-trips the state machine', async () => {
    const loaded = await inTenant(ACME, ({ tx }) => repository.load(tx, ACME, ADA));
    expect(loaded).toMatchObject({ status: 'active', hireDate: '2026-09-01' });
  });

  it('finds a record by the account it was provisioned from', async () => {
    // What makes the provisioning consumer idempotent: it asks first, and the
    // unique index is what answers if two arrive at once.
    const found = await inTenant(ACME, ({ tx }) => repository.findByAccount(tx, ACME, ACCOUNT));
    expect(found?.id).toBe(ADA);
  });

  it('keeps a salary exact rather than approximate', async () => {
    await inTenant(ACME, async ({ tx }) => {
      const snapshot = await repository.load(tx, ACME, ADA);
      if (!snapshot) throw new Error('vanished');
      const person = Person.rehydrate(snapshot);
      person.startLeave(context(), 'Etc/UTC');
      await repository.save(tx, person, {
        fields: { baseSalary: '55000.1234', salaryCurrency: 'EUR' },
      });
    });

    const rows = await admin.execute(sql`SELECT base_salary FROM people.person`);
    // A string out of the driver, because a `numeric(19,4)` parsed into a
    // JavaScript number is a salary that has quietly become a float.
    expect(String([...rows][0]?.['base_salary'])).toBe('55000.1234');
  });

  it('leaves unmentioned columns alone', async () => {
    // Drizzle writes every key present in the object, so a patch passed
    // through whole would blank every column the caller did not mention — a
    // phone-number update that erased a manager and a start date.
    await inTenant(ACME, async ({ tx }) => {
      const snapshot = await repository.load(tx, ACME, ADA);
      if (!snapshot) throw new Error('vanished');
      const person = Person.rehydrate(snapshot);
      person.startLeave(context(), 'Etc/UTC');
      await repository.save(tx, person, { fields: { workEmail: 'ada@acme.example' } });
    });

    const rows = await admin.execute(sql`SELECT given_name, work_email FROM people.person`);
    expect([...rows][0]).toMatchObject({ given_name: 'Ada', work_email: 'ada@acme.example' });
  });
});

describe('the unit of work', () => {
  it('scopes every statement to one tenant', async () => {
    await inTenant(ACME, async ({ tx }) => {
      const person = provisional();
      person.hire('2026-09-01', HIRED, context(), 'Etc/UTC');
      await repository.create(tx, person);
    });

    const seen = await inTenant(GLOBEX, ({ tx }) => repository.load(tx, GLOBEX, ADA));
    expect(seen).toBeNull();
  });

  it('releases the tenant when the transaction ends', async () => {
    // `set_config(..., true)` is transaction-scoped, which is what stops the
    // next unit of work on a pooled connection inheriting the last one's
    // tenant.
    await inTenant(ACME, async ({ tx }) => {
      const person = provisional();
      person.hire('2026-09-01', HIRED, context(), 'Etc/UTC');
      await repository.create(tx, person);
    });

    const loose = drizzle(serviceClient as ReturnType<typeof postgres>);
    const rows = await loose.execute(sql`SELECT id FROM people.person`);
    expect([...rows]).toEqual([]);
  });
});
