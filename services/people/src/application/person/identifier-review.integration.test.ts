import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { fixedClock } from '@kithena/domain-kit';
import { startPostgres } from '@kithena/testing';

import { inTenantResult, personAccess, type Asking } from './person-access.js';
import { decidePendingChange, type Holding, type PendingChangeDeps } from './pending-changes.js';
import { drizzlePendingChangeStore, outboxPendingChanges } from './pending-store.js';
import { drizzleRoleStore } from '../../infrastructure/drizzle-role-store.js';
import { open, seal } from '../../infrastructure/envelope.js';
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
import { claimRotation, drizzleUniqueClaims } from '../../infrastructure/unique.js';
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
const K1 = { id: 'k1', key: randomBytes(32) };
const K2 = { id: 'k2', key: randomBytes(32) };
const ring = staticKeyRing([K1]);

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
/** What the secret store logged: a reveal is a line here, and only a reviewer's may be. */
const logged: string[] = [];
const secrets = drizzleSecretStore(ring, { info: (_fields, message) => logged.push(message) });
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
    '20260926140000_people_visibility_rules.sql',
    '20260926180000_people_pending_change.sql',
    '20260926230000_people_pending_change_decided_as.sql',
    '20260922170000_people_person.sql',
    '20260924220000_people_access_end.sql',
    '20260926143000_people_duplicates.sql',
    '20260924220200_people_employment_period.sql',
    '20260923110000_people_completeness.sql',
    '20260924150000_people_unique_hash.sql',
    '20260924170000_people_calendar.sql',
    '20260924320000_people_effective_through.sql',
    '20260924330000_people_identifier_review.sql',
    '20260926230100_people_identifier_review_held.sql',
    '20260924270200_people_role_grant.sql',
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
    logged.length = 0;
    const saved = await write(lucia, LUCIA, { es_nif: '12.345.678-a' });
    // Recognised by its keyed hash: nothing was decrypted to compare.
    expect(logged).not.toContain('secret revealed');
    const [row] = [
      ...(await admin.execute(sql`
        SELECT value_hash, key_id FROM people.identifier_review WHERE state = 'accepted'`)),
    ];
    expect(row?.['key_id']).toBe('k1');
    expect(String(row?.['value_hash'])).not.toContain('12345678');
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

describe('a key rotation', () => {
  it('re-keys an accepted value’s fingerprint, so the acceptance outlives the key', async () => {
    // Marta's company PAN-like CIF: attention, accepted by HR.
    expect((await write(hr, MARTA, { es_nif: 'B12345678' })).ok).toBe(true);
    const accepted = await inTenantResult(inTenant, ACME, (tx) =>
      people.reviewIdentifier(tx, {
        ...as(hr),
        personId: MARTA,
        attributeKey: 'es_nif',
        decision: 'accept',
      }),
    );
    expect(accepted.ok).toBe(true);

    const keys = [K2, K1].map((k) => `${k.id}:${k.key.toString('base64')}`).join(',');
    await claimRotation(inTenant, keys, { clock, newEventId: newId })(ACME);
    const [row] = [
      ...(await admin.execute(sql`
        SELECT key_id FROM people.identifier_review
         WHERE person_id = ${MARTA}::uuid AND state = 'accepted'`)),
    ];
    expect(row?.['key_id']).toBe('k2');

    // k1 gone: the same value, saved again, is still the one HR accepted.
    const k2only = staticKeyRing([K2]);
    const after = personAccess({
      calendars: utcCalendars,
      people: drizzlePersonRepository(),
      reader: drizzlePersonReader(),
      schemas: drizzleSchemaVersions(),
      relations: drizzleRelations(),
      secrets: drizzleSecretStore(staticKeyRing([K2, K1])),
      reviews: drizzleIdentifierReviews(k2only, drizzleSecretStore(k2only)),
      uniques: drizzleUniqueClaims(k2only),
      clock,
      newId,
    });
    const again = await inTenantResult(inTenant, ACME, (tx) =>
      after.update(tx, { ...as(hr), personId: MARTA, changes: { es_nif: 'b-12345678' } }),
    );
    expect(again.ok && again.value.findings?.[0]?.review).toBe('accepted');
  });
});

describe('a doubted NIF held for approval: reviewed first, then approved (PEO-077)', () => {
  const NUR = '00000000-0000-4000-8000-0000000000a3';
  const nur = { accountId: '00000000-0000-4000-8000-0000000000b3', roles: new Set<string>() };
  const holding: Holding = {
    store: drizzlePendingChangeStore({
      seal: (plaintext) => seal(plaintext, ring),
      open: (sealed) => open(sealed, ring),
    }),
    publish: outboxPendingChanges,
    clock,
    newId,
  };
  const held = personAccess({
    calendars: utcCalendars,
    people: drizzlePersonRepository(),
    reader: drizzlePersonReader(),
    schemas: drizzleSchemaVersions(),
    relations: drizzleRelations(),
    secrets,
    reviews: drizzleIdentifierReviews(ring, secrets),
    uniques: drizzleUniqueClaims(ring),
    approvals: holding,
    clock,
    newId,
  });
  const pending: PendingChangeDeps = {
    ...holding,
    access: held,
    schemas: drizzleSchemaVersions(),
    reader: drizzlePersonReader(),
    relations: drizzleRelations(),
    reviews: drizzleIdentifierReviews(ring, secrets),
    roles: drizzleRoleStore(),
  };
  const submit = async (value: string) => {
    const written = await inTenantResult(inTenant, ACME, (tx) =>
      held.update(tx, { ...as(nur), personId: NUR, changes: { es_nif: value } }),
    );
    return written.ok ? (written.value.held?.[0]?.changeId ?? '') : '';
  };
  const decideAs = (decision: 'accept' | 'send_back', note?: string) =>
    inTenantResult(inTenant, ACME, (tx) =>
      held.reviewIdentifier(tx, {
        ...as(hr),
        personId: NUR,
        attributeKey: 'es_nif',
        decision,
        ...(note === undefined ? {} : { note }),
      }),
    );
  const approve = (changeId: string) =>
    inTenantResult(inTenant, ACME, (tx) =>
      decidePendingChange(tx, pending, { ...as(hr), changeId, approve: true }),
    );
  const rows = async () =>
    [
      ...(await admin.execute(sql`
        SELECT state, history_id, pending_change_id FROM people.identifier_review
         WHERE person_id = ${NUR}::uuid ORDER BY created_at, id`)),
    ] as { state: string; history_id: string | null; pending_change_id: string | null }[];
  const secret = async () =>
    [
      ...(await admin.execute(sql`
        SELECT 1 FROM people.person_secret WHERE person_id = ${NUR}::uuid AND attribute_key = 'es_nif'`)),
    ].length;

  beforeAll(async () => {
    await inTenant(ACME, ({ tx }) =>
      drizzlePersonRepository().create(
        tx,
        Person.rehydrate({
          id: NUR,
          tenantId: ACME,
          status: 'active',
          identityAccountId: nur.accountId,
          hireDate: '2026-01-01',
          lastWorkingDay: null,
        }),
        {},
      ),
    );
  });

  it('opens the review on the held value, lists and reveals it from the change, and refuses approval', async () => {
    const changeId = await submit(WRONG_NIF);
    expect(await rows()).toEqual([
      { state: 'pending', history_id: null, pending_change_id: changeId },
    ]);
    expect(await secret()).toBe(0);
    const listed = await inTenantResult(inTenant, ACME, (tx) => held.identifierReviews(tx, as(hr)));
    expect(listed.ok && listed.value.find((r) => r.personId === NUR)).toMatchObject({
      last4: '678A',
      pendingChangeId: changeId,
    });
    const shown = await inTenantResult(inTenant, ACME, (tx) =>
      held.revealIdentifier(tx, { ...as(hr), personId: NUR, attributeKey: 'es_nif' }),
    );
    expect(shown.ok && shown.value).toBe(WRONG_NIF);
    const early = await approve(changeId);
    expect(!early.ok && early.error.code).toBe('AWAITING_REVIEW');
  });

  it('declines the change when the review finds errors, with the reason, in one transaction', async () => {
    const silent = await decideAs('send_back');
    expect(!silent.ok && silent.error.code).toBe('REASON_REQUIRED');
    const sent = await decideAs('send_back', 'The letter on your card is Z');
    expect(sent.ok && sent.value.state).toBe('sent_back');
    const [change] = [
      ...(await admin.execute(sql`
        SELECT state, decided_as, note FROM people.pending_change WHERE person_id = ${NUR}::uuid`)),
    ];
    expect(change).toEqual({
      state: 'rejected',
      decided_as: 'identifier_review',
      note: 'The letter on your card is Z',
    });
    const decided = (await events('people.person.change_decided')).at(-1);
    expect(decided?.payload).toMatchObject({ decision: 'rejected', decidedAs: 'identifier_review' });
    const reviewed = (await events('people.person.identifier_reviewed')).at(-1);
    expect(reviewed?.payload).toMatchObject({ decision: 'sent_back', changeId: SOME_ID });
    expect(await secret()).toBe(0);
  });

  it('is answered by the corrected value, which needs approval only', async () => {
    const changeId = await submit('12345678Z');
    expect((await rows()).map((r) => r.state)).toEqual(['superseded']);
    const approved = await approve(changeId);
    expect(approved.ok).toBe(true);
    expect(await secret()).toBe(1);
  });

  it('writes a doubted value HR accepted once approved, without a second review', async () => {
    const changeId = await submit(WRONG_NIF);
    expect((await decideAs('accept')).ok).toBe(true);
    expect((await approve(changeId)).ok).toBe(true);
    const all = await rows();
    expect(all.map((r) => r.state)).toEqual(['superseded', 'accepted']);
    expect(all.at(-1)?.pending_change_id).toBe(changeId);
    const shown = await inTenantResult(inTenant, ACME, (tx) =>
      held.read(tx, { ...as(hr), personId: NUR }),
    );
    expect(shown.ok && shown.value.attributes['es_nif']).toMatchObject({ last4: '678A' });
    expect(JSON.stringify(await events('people.person.change_requested'))).not.toContain(
      '12345678',
    );
  });

  it('lets HR approve alone when the only other HR member is the subject, asked at decision time', async () => {
    // Two HR members by the role rows: the requester, and Nur, whose record it is.
    await admin.execute(sql`
      INSERT INTO people.role_grant (tenant_id, account_id, role)
      VALUES (${ACME}::uuid, ${hr.accountId}::uuid, 'hr'), (${ACME}::uuid, ${nur.accountId}::uuid, 'hr')
      ON CONFLICT DO NOTHING`);
    const written = await inTenantResult(inTenant, ACME, (tx) =>
      held.update(tx, { ...as(hr), personId: NUR, changes: { es_nif: '87654321X' } }),
    );
    const changeId = written.ok ? (written.value.held?.[0]?.changeId ?? '') : '';
    const alone = () =>
      inTenantResult(inTenant, ACME, (tx) =>
        decidePendingChange(tx, pending, { ...as(hr), changeId, approve: true, soleApprover: true }),
      );

    // A third HR member is an eligible approver: refused while they hold it.
    await admin.execute(sql`
      INSERT INTO people.role_grant (tenant_id, account_id, role)
      VALUES (${ACME}::uuid, ${LUCIA_ACCOUNT}::uuid, 'hr')`);
    const refused = await alone();
    expect(!refused.ok && refused.error.code).toBe('FORBIDDEN');
    await admin.execute(sql`
      DELETE FROM people.role_grant WHERE account_id = ${LUCIA_ACCOUNT}::uuid AND role = 'hr'`);

    expect((await alone()).ok).toBe(true);
    const [change] = [
      ...(await admin.execute(sql`
        SELECT state, decided_by::text, decided_as FROM people.pending_change
         WHERE id = ${changeId}::uuid`)),
    ];
    expect(change).toEqual({ state: 'approved', decided_by: hr.accountId, decided_as: 'sole_hr' });
  });
});
