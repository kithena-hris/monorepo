import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
import {
  drizzlePeopleFacts,
  drizzleSchemaRepository,
} from '../../infrastructure/drizzle-schema-repository.js';
import { staticKeyRing } from '../../infrastructure/envelope.js';
import { drizzleSecretStore } from '../../infrastructure/secret-store.js';
import { drizzleUniqueClaims } from '../../infrastructure/unique.js';
import { tenantTransaction } from '../../infrastructure/unit-of-work.js';
import { utcCalendars } from '../org/org.js';
import { define, versionOf } from '../person/in-memory.js';
import { inTenantResult, personAccess } from '../person/person-access.js';
import type { Viewer } from '../person/ports.js';
import { recomputePerson } from './recompute.js';

/**
 * PEO-102/103: a person's completeness follows their record, not only a
 * publish. Every write re-judges the one person in its own transaction, the
 * gap row the reminder reads moves with it, and an event goes out only on a
 * real transition. A pre-hire is asked only for what is collected before the
 * first day (§8.1).
 */

const ACME = '00000000-0000-4000-8000-00000000000a';
const ADA = '00000000-0000-4000-8000-0000000000a1';
const ADA_ACCOUNT = '00000000-0000-4000-8000-0000000000b1';
const NEW = '00000000-0000-4000-8000-0000000000a2';
const BEA = '00000000-0000-4000-8000-0000000000a3';
const BEA_ACCOUNT = '00000000-0000-4000-8000-0000000000b3';
const NOW = '2026-09-22T10:00:00.000Z';

const costCentre = define({ key: 'cost_centre', requiredness: { mode: 'always' } });
const phone = define({
  key: 'phone',
  requiredness: { mode: 'always' },
  ownership: ['employee'],
  collectAt: 'onboarding',
});
const iban = define({
  key: 'iban',
  dataType: 'bank_account',
  typeConfig: { kind: 'bank_account', country: 'DE' },
  encrypted: true,
  requiredness: { mode: 'always' },
  visibility: ['self', 'hr'],
  ownership: ['employee'],
  collectAt: 'onboarding',
  classification: {
    classification: 'confidential',
    piiKind: 'financial',
    exportable: true,
    aiEligible: false,
  },
});
const hireDate = define({
  key: 'hire_date',
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
const clock = fixedClock(NOW);
const store = drizzleCompletenessStore();
const people = personAccess({
  calendars: utcCalendars,
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
    store,
    clock,
    newEventId: newId,
    calendars: utcCalendars,
  }),
});

const viewer = (accountId: string, ...roles: string[]): Viewer => ({
  accountId,
  roles: new Set(roles),
});
const hr = viewer('00000000-0000-4000-8000-0000000000ff', 'hr');
const ada = viewer(ADA_ACCOUNT);
const asking = (v: Viewer) => ({
  tenantId: ACME,
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
    '20260926140000_people_visibility_rules.sql',
    '20260926180000_people_pending_change.sql',
    '20260922170000_people_person.sql',
    '20260924220000_people_access_end.sql',
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

  await inTenant(ACME, ({ tx }) =>
    drizzleSchemaRepository().appendVersion(
      tx,
      ACME,
      versionOf(1, [costCentre, phone, iban, hireDate]),
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

// History is append-only by trigger, so each test has people of its own.
beforeEach(async () => {
  await admin.execute(sql`DELETE FROM people.outbox`);
});

const seed = (id: string, status: 'active' | 'provisional', account: string | null) =>
  inTenant(ACME, ({ tx }) =>
    drizzlePersonRepository().create(
      tx,
      Person.rehydrate({
        id,
        tenantId: ACME,
        status,
        identityAccountId: account,
        hireDate: status === 'active' ? '2026-01-01' : null,
        lastWorkingDay: null,
      }),
      { givenName: 'Ada', familyName: 'Lovelace', workEmail: `${id.slice(-2)}@acme.test` },
    ),
  );

const write = (v: Viewer, personId: string, changes: Record<string, unknown>) =>
  inTenantResult(inTenant, ACME, (tx) => people.update(tx, { ...asking(v), personId, changes }));

async function state(personId: string) {
  const rows = [
    ...(await admin.execute(sql`
      SELECT p.completeness, g.employee_keys, g.staff_keys
        FROM people.person p
        LEFT JOIN people.completeness_gap g ON g.person_id = p.id
       WHERE p.id = ${personId}::uuid`)),
  ];
  const row = rows[0] ?? {};
  return {
    completeness: row['completeness'],
    employee: row['employee_keys'],
    staff: row['staff_keys'],
  };
}

async function raised(): Promise<string[]> {
  const rows = await admin.execute(sql`
    SELECT event_name FROM people.outbox
     WHERE event_name IN ('people.person.profile_incomplete', 'people.person.profile_completed')
     ORDER BY event_id`);
  return [...rows].map((r) => (r['event_name'] as string).replace('people.person.', ''));
}

const due = () =>
  inTenant(ACME, ({ tx }) =>
    store.dueReminders(tx, ACME, new Date(NOW), { after: null, limit: 500 }),
  ).then((d) => d.map((r) => r.personId));

describe('a field filled, cleared or corrected', () => {
  it('moves the stored state, the gaps and the reminder in the same transaction', async () => {
    await seed(ADA, 'active', ADA_ACCOUNT);

    // HR fills its own field: Ada is judged for the first time, and is missing hers.
    expect((await write(hr, ADA, { cost_centre: 'ENG-1' })).ok).toBe(true);
    expect(await state(ADA)).toEqual({
      completeness: 'incomplete',
      employee: ['phone', 'iban'],
      staff: [],
    });
    expect(await raised()).toEqual(['profile_incomplete']);
    expect(await due()).toEqual([ADA]);

    // Ada fills one: still incomplete, no second event, one key left.
    expect((await write(ada, ADA, { phone: '+44 20 7946 0000' })).ok).toBe(true);
    expect(await state(ADA)).toMatchObject({ completeness: 'incomplete', employee: ['iban'] });
    expect(await raised()).toEqual(['profile_incomplete']);

    // The sealed one closes the gap: a secret is present though its value is not in the row.
    expect((await write(ada, ADA, { iban: 'DE89370400440532013000' })).ok).toBe(true);
    expect(await state(ADA)).toEqual({ completeness: 'complete', employee: [], staff: [] });
    expect(await raised()).toEqual(['profile_incomplete', 'profile_completed']);
    // Nothing left to remind her of, at once rather than at the next publish.
    expect(await due()).toEqual([]);

    // HR clears its field: incomplete again, HR's gap.
    expect((await write(hr, ADA, { cost_centre: null })).ok).toBe(true);
    expect(await state(ADA)).toEqual({
      completeness: 'incomplete',
      employee: [],
      staff: ['cost_centre'],
    });
    expect(await raised()).toEqual([
      'profile_incomplete',
      'profile_completed',
      'profile_incomplete',
    ]);

    // A correction that fills it again is a transition too.
    const [entry] = [
      ...(await admin.execute(sql`
        SELECT id FROM people.person_attribute_history
         WHERE person_id = ${ADA}::uuid AND attribute_key = 'cost_centre' AND value IS NULL`)),
    ];
    const corrected = await inTenantResult(inTenant, ACME, (tx) =>
      people.correct(tx, {
        ...asking(hr),
        personId: ADA,
        supersedes: entry?.['id'] as string,
        value: 'ENG-2',
        reason: 'cleared by mistake',
      }),
    );
    expect(corrected.ok).toBe(true);
    expect((await state(ADA)).completeness).toBe('complete');
    expect(await raised()).toHaveLength(4);
  });

  it('raises nothing for a write that leaves the state where it was', async () => {
    await seed(BEA, 'active', BEA_ACCOUNT);
    await write(hr, BEA, { cost_centre: 'ENG-1' });
    await write(hr, BEA, { cost_centre: 'ENG-9' });
    expect(await raised()).toEqual(['profile_incomplete']);
  });
});

describe('a status that moves (§8.1)', () => {
  const hire = (date: string) =>
    inTenantResult(inTenant, ACME, (tx) =>
      people.hire(tx, { ...asking(hr), personId: NEW, hireDate: date }),
    );
  const correctHireDate = async (value: string) => {
    const [entry] = [
      ...(await admin.execute(sql`
        SELECT id FROM people.person_attribute_history
         WHERE person_id = ${NEW}::uuid AND attribute_key = 'hire_date'
         ORDER BY recorded_at DESC, id DESC LIMIT 1`)),
    ];
    return inTenantResult(inTenant, ACME, (tx) =>
      people.correct(tx, {
        ...asking(hr),
        personId: NEW,
        supersedes: entry?.['id'] as string,
        value,
        reason: null,
      }),
    );
  };

  it('asks a pre-hire only for onboarding fields, then everything once they start', async () => {
    await seed(NEW, 'provisional', null);
    expect((await state(NEW)).completeness).toBe('not_applicable');

    // Hired for December: a pre-hire. Cost centre is HR-only and waits.
    expect((await hire('2026-12-01')).ok).toBe(true);
    expect(await state(NEW)).toEqual({
      completeness: 'incomplete',
      employee: ['phone', 'iban'],
      staff: [],
    });

    // The start date was really in September: active, and HR's field applies.
    expect((await correctHireDate('2026-09-01')).ok).toBe(true);
    expect(await state(NEW)).toMatchObject({ staff: ['cost_centre'] });

    // Back into the future (PEO-100): a pre-hire again, and HR's gap closes.
    expect((await correctHireDate('2026-11-01')).ok).toBe(true);
    expect(await state(NEW)).toMatchObject({ completeness: 'incomplete', staff: [] });
    expect(await raised()).toEqual(['profile_incomplete']);
  });
});
