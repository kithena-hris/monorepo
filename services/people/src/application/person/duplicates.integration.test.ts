import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { fixedClock } from '@kithena/domain-kit';
import { startPostgres } from '@kithena/testing';

import { inTenantResult, personAccess, type Asking } from './person-access.js';
import { duplicatesView } from '../screens/people.js';
import type { ScreenDeps } from '../screens/record.js';
import { publishSchema } from '../schema/publish-schema.js';
import { utcCalendars } from '../org/org.js';
import { Person, type PersonState } from '../../domain/person/person.js';
import { COUNTRY_PACKS } from '../../country-packs/packs.js';
import { seedCountryPack } from '../../country-packs/seed.js';
import { CORE_PACK } from '../../country-packs/core.js';
import { drizzleDuplicates } from '../../infrastructure/drizzle-duplicates.js';
import { drizzleIdentifierReviews } from '../../infrastructure/drizzle-identifier-reviews.js';
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

/**
 * PEO-074 over the real tables. The usual duplicate: HR entered a starter by
 * hand, and the starter's account arrived as a provisional record of its own
 * with the same work email. The queue offers the pair and never merges it;
 * HR merges, and the account's record becomes a tombstone pointing at HR's,
 * its account and its claims move across, both histories stay, and every
 * step is an event and a decision row.
 */

const ACME = '00000000-0000-4000-8000-00000000000a';
const HR_RECORD = '00000000-0000-4000-8000-0000000000a1';
const SIGNED_UP = '00000000-0000-4000-8000-0000000000a2';
const LEAVER = '00000000-0000-4000-8000-0000000000a3';
const OTHER = '00000000-0000-4000-8000-0000000000a4';
const ADA_ACCOUNT = '00000000-0000-4000-8000-0000000000b1';
const clock = fixedClock('2026-09-26T09:00:00.000Z');
const ring = staticKeyRing([{ id: 'k1', key: randomBytes(32) }]);
const NIF = '12345678Z';

let stopPg: (() => Promise<void>) | undefined;
let adminClient: ReturnType<typeof postgres> | undefined;
let serviceClient: ReturnType<typeof postgres> | undefined;
let admin: PostgresJsDatabase;
let inTenant: ReturnType<typeof tenantTransaction>;

let ids = 0;
const newId = () => `01890000-0000-7000-8000-${String((ids += 1)).padStart(12, '0')}`;
const secrets = drizzleSecretStore(ring);
const people = personAccess({
  calendars: utcCalendars,
  people: drizzlePersonRepository(),
  reader: drizzlePersonReader(),
  schemas: drizzleSchemaVersions(),
  relations: drizzleRelations(),
  secrets,
  reviews: drizzleIdentifierReviews(ring, secrets),
  duplicates: drizzleDuplicates(),
  uniques: drizzleUniqueClaims(ring),
  clock,
  newId,
});

const hr = { accountId: '00000000-0000-4000-8000-0000000000ff', roles: new Set(['hr']) };
const ada = { accountId: ADA_ACCOUNT, roles: new Set<string>() };
const as = (viewer: Asking['viewer']): Asking => ({
  tenantId: ACME,
  viewer,
  correlationId: '00000000-0000-4000-8000-0000000000c1',
});

const queue = (viewer: Asking['viewer'] = hr) =>
  inTenantResult(inTenant, ACME, (tx) => people.duplicates(tx, as(viewer)));
const merge = (survivor: string, absorbed: string, take: string[] = [], viewer = hr) =>
  inTenantResult(inTenant, ACME, (tx) =>
    people.merge(tx, { ...as(viewer), personId: survivor, absorbedPersonId: absorbed, take }),
  );
const payloads = async (name: string) =>
  [
    ...(await admin.execute(sql`
      SELECT envelope FROM people.outbox WHERE event_name = ${name} ORDER BY created_at
    `)),
  ].map((r) => (r['envelope'] as { payload: Record<string, unknown> }).payload);

const migration = (file: string): Promise<string> =>
  readFile(new URL(`../../../../../migrations/${file}`, import.meta.url), 'utf8');

async function create(
  id: string,
  status: PersonState,
  account: string | null,
  fields: Record<string, unknown>,
): Promise<void> {
  await inTenant(ACME, ({ tx }) =>
    drizzlePersonRepository().create(
      tx,
      Person.rehydrate({
        id,
        tenantId: ACME,
        status,
        identityAccountId: account,
        hireDate: status === 'provisional' ? null : '2026-01-05',
        lastWorkingDay: null,
      }),
      fields,
    ),
  );
}

beforeAll(async () => {
  const pg = await startPostgres();
  stopPg = pg.stop;
  adminClient = postgres(pg.url, { max: 1 });
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
    '20260924320000_people_effective_through.sql',
    '20260924330000_people_identifier_review.sql',
    '20260926143000_people_duplicates.sql',
  ]) {
    await admin.execute(sql.raw(await migration(file)));
  }
  await admin.execute(sql`ALTER ROLE svc_people LOGIN PASSWORD 'svc_people'`);
  const asService = new URL(pg.url);
  asService.username = 'svc_people';
  asService.password = 'svc_people';
  serviceClient = postgres(asService.toString(), { max: 4 });
  inTenant = tenantTransaction(drizzle(serviceClient));

  await inTenant(ACME, async ({ tx }) => {
    expect((await seedCountryPack(tx, ACME, CORE_PACK)).ok).toBe(true);
    expect((await seedCountryPack(tx, ACME, COUNTRY_PACKS.ES)).ok).toBe(true);
  });
  const published = await inTenant(ACME, ({ tx }) =>
    publishSchema({
      calendars: utcCalendars,
      schema: drizzleSchemaRepository(),
      people: drizzlePeopleFacts(),
      clock,
      newEventId: newId,
    }).publish(tx, {
      tenantId: ACME,
      actor: { kind: 'system', process: 'country-pack' },
      publishedBy: null,
      correlationId: '00000000-0000-4000-8000-0000000000c1',
      artifactUrl: 'https://api.kithena.test/v1/people/schema/1',
    }),
  );
  expect(published.ok).toBe(true);

  await create(HR_RECORD, 'active', null, {
    givenName: 'Ada',
    familyName: 'Lovelace',
    workEmail: 'ada@acme.test',
  });
  await create(SIGNED_UP, 'provisional', ADA_ACCOUNT, {
    givenName: 'Augusta',
    familyName: 'Lovelace',
    workEmail: 'ADA@acme.test ',
  });
  await create(LEAVER, 'terminated', null, { givenName: 'Grace', workEmail: 'grace@acme.test' });
  await create(OTHER, 'active', null, { givenName: 'Grace', workEmail: 'grace@acme.test' });

  // Ada types her NIF on her own, provisional, record: a unique claim.
  const typed = await inTenantResult(inTenant, ACME, (tx) =>
    people.update(tx, { ...as(ada), personId: SIGNED_UP, changes: { es_nif: NIF } }),
  );
  expect(typed.ok).toBe(true);
});

afterAll(async () => {
  await serviceClient?.end();
  await adminClient?.end();
  await stopPg?.();
});

describe('the queue', () => {
  it('offers pairs sharing a work email, whatever its case and spacing, and merges nothing', async () => {
    const listed = await queue();
    expect(listed.ok && listed.value).toEqual([
      { personIds: [HR_RECORD, SIGNED_UP], signals: [{ signal: 'work_email', attributeKey: null }] },
      { personIds: [LEAVER, OTHER], signals: [{ signal: 'work_email', attributeKey: null }] },
    ]);
    const statuses = await admin.execute(sql`SELECT status FROM people.person ORDER BY id`);
    expect([...statuses].map((r) => r['status'])).toEqual([
      'active',
      'provisional',
      'terminated',
      'active',
    ]);
  });

  it('is HR’s alone', async () => {
    const refused = await queue(ada);
    expect(!refused.ok && refused.error.code).toBe('FORBIDDEN');
  });

  it('stops offering a pair HR says are two people', async () => {
    const dismissed = await inTenantResult(inTenant, ACME, (tx) =>
      people.dismissDuplicate(tx, { ...as(hr), personIds: [OTHER, LEAVER] }),
    );
    expect(dismissed.ok).toBe(true);
    const listed = await queue();
    expect(listed.ok && listed.value.map((c) => c.personIds)).toEqual([[HR_RECORD, SIGNED_UP]]);
  });
});

describe('merging', () => {
  it('never absorbs an employed record: that is payroll history', async () => {
    const refused = await merge(SIGNED_UP, HR_RECORD);
    expect(!refused.ok && refused.error.code).toBe('MERGE_ABSORBS_EMPLOYMENT');
  });

  it('is refused to anybody but HR, and to the person themselves', async () => {
    const byAda = await merge(HR_RECORD, SIGNED_UP, [], ada);
    expect(!byAda.ok && byAda.error.code).toBe('FORBIDDEN');
    const adaInHr = { accountId: ADA_ACCOUNT, roles: new Set(['hr']) };
    const ownRecord = await merge(HR_RECORD, SIGNED_UP, [], adaInHr);
    expect(!ownRecord.ok && ownRecord.error.code).toBe('FORBIDDEN');
  });

  it('refuses a sealed value, which it would have to decrypt to copy', async () => {
    const refused = await merge(HR_RECORD, SIGNED_UP, ['es_nif']);
    expect(!refused.ok && refused.error.code).toBe('FIELD_NOT_WRITABLE');
  });

  it('says what the comparison may offer before anything is written', async () => {
    const options = await inTenantResult(inTenant, ACME, (tx) =>
      people.mergeOptions(tx, { ...as(hr), personId: HR_RECORD, absorbedPersonId: SIGNED_UP }),
    );
    expect(options.ok && options.value.refusal).toBeNull();
    expect(options.ok && options.value.takeable).toContain('given_name');
    expect(options.ok && options.value.takeable).not.toContain('es_nif');
    expect(options.ok && options.value.takeable).not.toContain('employee_number');
  });

  it('shows HR the pair side by side: which way it may go, and a sealed value as its last four', async () => {
    const deps: ScreenDeps = {
      service: { access: people, schemas: drizzleSchemaVersions(), inTenant },
      relations: drizzleRelations(),
      clock,
      personOf: (tx, tenantId, accountId) => drizzlePersonReader().personOf(tx, tenantId, accountId),
      calendars: utcCalendars,
      gapTotals: () => Promise.resolve({ waiting: 0, staff: [] }),
    };
    const view = await duplicatesView(deps, as(hr), [HR_RECORD, SIGNED_UP]);
    expect(view.ok).toBe(true);
    if (!view.ok) return;
    expect(view.value.items).toEqual([
      {
        personIds: [HR_RECORD, SIGNED_UP],
        names: ['Ada Lovelace', 'Augusta Lovelace'],
        reasons: ['Same work email'],
      },
    ]);
    const compared = view.value.comparison;
    expect(compared?.people.map((p) => [p.id, p.refusal === null])).toEqual([
      [HR_RECORD, true],
      [SIGNED_UP, false],
    ]);
    expect(compared?.rows).toContainEqual({
      key: 'given_name',
      label: 'Legal first name',
      values: ['Ada', 'Augusta'],
      same: false,
      takeable: [false, true],
    });
    expect(compared?.rows.find((r) => r.key === 'es_nif')).toMatchObject({
      values: [null, '•••• 678Z'],
      takeable: [false, false],
    });
  });

  it('leaves a tombstone pointing at the survivor, with its account and the chosen value moved', async () => {
    const merged = await merge(HR_RECORD, SIGNED_UP, ['given_name']);
    expect(merged.ok).toBe(true);
    if (!merged.ok) return;
    expect(merged.value.attributes['given_name']).toBe('Augusta');

    const rows = await admin.execute(sql`
      SELECT id, status, merged_into, identity_account_id, given_name FROM people.person
       WHERE id IN (${HR_RECORD}::uuid, ${SIGNED_UP}::uuid) ORDER BY id`);
    expect([...rows]).toEqual([
      {
        id: HR_RECORD,
        status: 'active',
        merged_into: null,
        identity_account_id: ADA_ACCOUNT,
        given_name: 'Augusta',
      },
      {
        id: SIGNED_UP,
        status: 'merged',
        merged_into: HR_RECORD,
        identity_account_id: null,
        given_name: 'Augusta',
      },
    ]);
  });

  it('keeps both histories where they were written', async () => {
    const rows = await admin.execute(sql`
      SELECT person_id, attribute_key FROM people.person_attribute_history
       WHERE person_id IN (${HR_RECORD}::uuid, ${SIGNED_UP}::uuid) ORDER BY person_id, attribute_key`);
    expect([...rows]).toEqual([
      { person_id: HR_RECORD, attribute_key: 'given_name' },
      { person_id: SIGNED_UP, attribute_key: 'es_nif' },
    ]);
  });

  it('releases the tombstone’s claims, so the survivor may hold the same value', async () => {
    const claims = await admin.execute(sql`
      SELECT count(*)::int AS n FROM people.attribute_unique WHERE person_id = ${SIGNED_UP}::uuid`);
    expect([...claims][0]?.['n']).toBe(0);
    const typed = await inTenantResult(inTenant, ACME, (tx) =>
      people.update(tx, { ...as(ada), personId: HR_RECORD, changes: { es_nif: NIF } }),
    );
    expect(typed.ok).toBe(true);
  });

  it('tells every consumer: the tombstone’s status and merge, the survivor’s change and identity’s facts', async () => {
    expect(await payloads('people.person.merged')).toEqual([
      {
        survivingPersonId: HR_RECORD,
        absorbedPersonId: SIGNED_UP,
        attributesTaken: ['given_name'],
        identityAccountId: ADA_ACCOUNT,
      },
    ]);
    expect(await payloads('people.person.status_changed')).toContainEqual({
      personId: SIGNED_UP,
      previous: 'provisional',
      next: 'merged',
      reason: 'merged',
    });
    expect(await payloads('people.person.identity_facts_changed')).toContainEqual(
      expect.objectContaining({ personId: HR_RECORD, identityAccountId: ADA_ACCOUNT }),
    );
  });

  it('records the decision, with names and never values', async () => {
    const rows = await admin.execute(sql`
      SELECT decision, survivor_id, absorbed_id, attributes_taken, decided_by
        FROM people.duplicate_decision WHERE decision = 'merged'`);
    expect([...rows]).toEqual([
      {
        decision: 'merged',
        survivor_id: HR_RECORD,
        absorbed_id: SIGNED_UP,
        attributes_taken: ['given_name'],
        decided_by: hr.accountId,
      },
    ]);
  });

  it('empties the queue, and refuses the same merge twice', async () => {
    const listed = await queue();
    expect(listed.ok && listed.value).toEqual([]);
    const again = await merge(HR_RECORD, SIGNED_UP);
    expect(!again.ok && again.error.code).toBe('MERGE_TOMBSTONE');
  });

  it('lets Ada sign in to the survivor', async () => {
    const own = await inTenant(ACME, ({ tx }) => drizzlePersonReader().personOf(tx, ACME, ADA_ACCOUNT));
    expect(own).toBe(HR_RECORD);
  });
});
