import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { fixedClock } from '@kithena/domain-kit';
import { startPostgres } from '@kithena/testing';

import { inTenantResult, personAccess, type Asking } from './person-access.js';
import { publishSchema } from '../schema/publish-schema.js';
import { utcCalendars } from '../org/org.js';
import { Person } from '../../domain/person/person.js';
import { COUNTRY_PACKS } from '../../country-packs/packs.js';
import { seedCountryPack } from '../../country-packs/seed.js';
import { drizzleCompletenessStore } from '../../infrastructure/drizzle-completeness-store.js';
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
 * PEO-125 over the real tables: a doubted national identifier is saved, its
 * findings come back to the writer, HR's queue lists it, the reviewer's
 * decision is final and audited, and neither the review record nor any event
 * ever holds the value.
 */

const ACME = '00000000-0000-4000-8000-00000000000a';
const LUCIA = '00000000-0000-4000-8000-0000000000a1';
const MARTA = '00000000-0000-4000-8000-0000000000a2';
const LUCIA_ACCOUNT = '00000000-0000-4000-8000-0000000000b1';
const clock = fixedClock('2026-09-24T09:00:00.000Z');
const ring = staticKeyRing([{ id: 'k1', key: randomBytes(32) }]);

/** 12345678Z is the DNI; Z is its control letter, A is not. */
const WRONG_NIF = '12345678A';
const SOME_ID: unknown = expect.any(String);

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
  uniques: drizzleUniqueClaims(ring),
  clock,
  newId,
});

const hr = { accountId: '00000000-0000-4000-8000-0000000000ff', roles: new Set(['hr']) };
const lucia = { accountId: LUCIA_ACCOUNT, roles: new Set<string>() };
const as = (viewer: Asking['viewer']): Asking => ({
  tenantId: ACME,
  viewer,
  correlationId: '00000000-0000-4000-8000-0000000000c1',
});

const write = (viewer: Asking['viewer'], personId: string, changes: Record<string, unknown>) =>
  inTenantResult(inTenant, ACME, (tx) => people.update(tx, { ...as(viewer), personId, changes }));
const queue = (viewer: Asking['viewer'] = hr) =>
  inTenantResult(inTenant, ACME, (tx) => people.identifierReviews(tx, as(viewer)));
const review = (decision: 'accept' | 'send_back', personId = LUCIA, note?: string) =>
  inTenantResult(inTenant, ACME, (tx) =>
    people.reviewIdentifier(tx, {
      ...as(hr),
      personId,
      attributeKey: 'es_nif',
      decision,
      ...(note === undefined ? {} : { note }),
    }),
  );
const events = async (name: string) =>
  [
    ...(await admin.execute(sql`
      SELECT envelope FROM people.outbox WHERE event_name = ${name} ORDER BY created_at
    `)),
  ].map((r) => r['envelope'] as { payload: Record<string, unknown>; actor: unknown });

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
    '20260922170000_people_person.sql',
    '20260924220000_people_access_end.sql',
    '20260924220200_people_employment_period.sql',
    '20260923110000_people_completeness.sql',
    '20260924150000_people_unique_hash.sql',
    '20260924170000_people_calendar.sql',
    '20260924320000_people_effective_through.sql',
    '20260924330000_people_identifier_review.sql',
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

  for (const [id, account] of [
    [LUCIA, LUCIA_ACCOUNT],
    [MARTA, null],
  ] as const) {
    await inTenant(ACME, ({ tx }) =>
      drizzlePersonRepository().create(
        tx,
        Person.rehydrate({
          id,
          tenantId: ACME,
          status: 'active',
          identityAccountId: account,
          hireDate: '2026-01-01',
          lastWorkingDay: null,
        }),
        {},
      ),
    );
  }
});

afterAll(async () => {
  await serviceClient?.end();
  await adminClient?.end();
  await stopPg?.();
});

describe('an employee entering a national identifier our checks doubt', () => {
  it('is refused only when it cannot be the identifier at all', async () => {
    const refused = await write(lucia, LUCIA, { es_nif: '1234567Z' });
    expect(!refused.ok && refused.error.code).toBe('VALUE_INVALID');
    expect(!refused.ok && refused.error.path).toEqual(['es_nif']);
  });

  it('is saved, told what the check found, and queued for HR', async () => {
    const saved = await write(lucia, LUCIA, { es_nif: WRONG_NIF });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.value.findings).toEqual([
      {
        key: 'es_nif',
        review: 'pending',
        findings: [expect.objectContaining({ level: 'mismatch', code: 'check_mismatch' })],
      },
    ]);

    const listed = await queue();
    expect(listed.ok && listed.value).toEqual([
      expect.objectContaining({
        personId: LUCIA,
        attributeKey: 'es_nif',
        label: 'NIF / NIE',
        state: 'pending',
        last4: '678A',
      }),
    ]);
  });

  it('is a row on HR’s grid, naming the person and never the value', async () => {
    const grid = await inTenant(ACME, ({ tx }) =>
      drizzleCompletenessStore().staffGrid(tx, ACME, '2026-09-24'),
    );
    expect(grid.filter((row) => row.task === 'identifier_review')).toEqual([
      { task: 'identifier_review', key: 'es_nif', personIds: [LUCIA] },
    ]);
  });

  it('keys the review to the history row, and leaves history as it was', async () => {
    const rows = await admin.execute(sql`
      SELECT r.history_id, h.value, h.attribute_key
        FROM people.identifier_review r JOIN people.person_attribute_history h ON h.id = r.history_id
    `);
    expect([...rows]).toEqual([
      { history_id: SOME_ID, value: null, attribute_key: 'es_nif' },
    ]);
  });

  it('is HR’s queue alone', async () => {
    const refused = await queue(lucia);
    expect(!refused.ok && refused.error.code).toBe('FORBIDDEN');
    const decided = await inTenantResult(inTenant, ACME, (tx) =>
      people.reviewIdentifier(tx, {
        ...as(lucia),
        personId: LUCIA,
        attributeKey: 'es_nif',
        decision: 'accept',
      }),
    );
    expect(!decided.ok && decided.error.code).toBe('FORBIDDEN');
  });

  it('shows the reviewer the value only through the audited reveal', async () => {
    const shown = await inTenantResult(inTenant, ACME, (tx) =>
      people.revealIdentifier(tx, { ...as(hr), personId: LUCIA, attributeKey: 'es_nif' }),
    );
    expect(shown.ok && shown.value).toBe(WRONG_NIF);
    const revealed = await events('people.person.identifier_revealed');
    expect(revealed).toHaveLength(1);
    expect(revealed[0]?.payload).toEqual({
      personId: LUCIA,
      attributeKey: 'es_nif',
      reviewId: SOME_ID,
    });
    expect(revealed[0]?.actor).toEqual({ kind: 'user', userId: hr.accountId });
  });
});

describe('the reviewer accepting', () => {
  it('is final, and audited with the finding codes and never the value', async () => {
    const accepted = await review('accept');
    expect(accepted.ok && accepted.value.state).toBe('accepted');

    const again = await review('send_back');
    expect(!again.ok && again.error.code).toBe('NOT_FOUND');

    const reviewed = await events('people.person.identifier_reviewed');
    expect(reviewed.map((e) => e.payload)).toEqual([
      {
        personId: LUCIA,
        attributeKey: 'es_nif',
        reviewId: SOME_ID,
        decision: 'accepted',
        findingCodes: ['check_mismatch'],
        note: null,
      },
    ]);
    expect((await queue()).ok && (await queue())).toMatchObject({ value: [] });
  });

  it('is never asked again for the same value, however it is spaced', async () => {
    const saved = await write(lucia, LUCIA, { es_nif: '12.345.678-a' });
    expect(saved.ok && saved.value.findings?.[0]?.review).toBe('accepted');
    const listed = await queue();
    expect(listed.ok && listed.value).toEqual([]);
  });

  it('is not a pass for a different doubtful value', async () => {
    const saved = await write(lucia, LUCIA, { es_nif: '87654321A' });
    expect(saved.ok && saved.value.findings?.[0]?.review).toBe('pending');
    const listed = await queue();
    expect(listed.ok && listed.value.length).toBe(1);
  });
});

describe('the reviewer sending a value back', () => {
  it('asks the employee to correct it, which completeness shows', async () => {
    const sent = await review('send_back', LUCIA, 'The letter on your card is different');
    expect(sent.ok && sent.value).toMatchObject({
      state: 'sent_back',
      note: 'The letter on your card is different',
    });
    const verdict = await inTenantResult(inTenant, ACME, (tx) =>
      people.completeness(tx, { ...as(lucia), personId: LUCIA }),
    );
    expect(verdict.ok && verdict.value.attention).toEqual(['es_nif']);
    const own = await inTenantResult(inTenant, ACME, (tx) =>
      people.personReviews(tx, { ...as(lucia), personId: LUCIA }),
    );
    expect(own.ok && own.value.map((r) => r.state)).toEqual(['sent_back']);
  });

  it('closes when the employee writes a value every check passes', async () => {
    const saved = await write(lucia, LUCIA, { es_nif: '87654321X' });
    expect(saved.ok && saved.value.findings?.[0]).toMatchObject({ review: 'none' });
    const verdict = await inTenantResult(inTenant, ACME, (tx) =>
      people.completeness(tx, { ...as(lucia), personId: LUCIA }),
    );
    expect(verdict.ok && verdict.value.attention).toEqual([]);
    const states = await admin.execute(sql`
      SELECT state FROM people.identifier_review ORDER BY created_at, id
    `);
    expect([...states].map((r) => r['state'])).toEqual(['accepted', 'superseded']);
  });
});

describe('what is stored', () => {
  it('never holds a value, in the reviews or on any event', async () => {
    const dump = JSON.stringify([
      ...(await admin.execute(sql`SELECT * FROM people.identifier_review`)),
      ...(await admin.execute(sql`SELECT envelope FROM people.outbox`)),
    ]).toUpperCase();
    for (const value of [WRONG_NIF, '87654321A', '87654321X', '12345678']) {
      expect(dump).not.toContain(value);
    }
  });

  it('a clean value opens nothing', async () => {
    const saved = await write(hr, MARTA, { es_nif: 'X1234567L' });
    expect(saved.ok && saved.value.findings).toEqual([
      { key: 'es_nif', review: 'none', findings: [expect.objectContaining({ level: 'ok' })] },
    ]);
    const rows = await admin.execute(sql`
      SELECT count(*)::int AS n FROM people.identifier_review WHERE person_id = ${MARTA}::uuid
    `);
    expect(Number([...rows][0]?.['n'])).toBe(0);
  });
});
