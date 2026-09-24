import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { fixedClock, systemClock } from '@kithena/domain-kit';
import { startOpenFga, startPostgres } from '@kithena/testing';

import { Person } from '../../domain/person/person.js';
import { peopleConsumer } from '../../infrastructure/consumers/handle.js';
import { drizzleProvisionalPeople } from '../../infrastructure/consumers/identity.js';
import { drizzleCompletenessStore } from '../../infrastructure/drizzle-completeness-store.js';
import { drizzleEmployeeNumbers, drizzleOrgStore } from '../../infrastructure/drizzle-org-store.js';
import {
  drizzleGapTotals,
  drizzlePersonReader,
  drizzleRelations,
  drizzleScheduled,
  drizzleSchemaVersions,
} from '../../infrastructure/drizzle-person-reader.js';
import { drizzlePersonRepository } from '../../infrastructure/drizzle-person-repository.js';
import {
  drizzlePeopleFacts,
  drizzleSchemaRepository,
} from '../../infrastructure/drizzle-schema-repository.js';
import { staticKeyRing } from '../../infrastructure/envelope.js';
import { openFga, type OpenFga } from '../../infrastructure/openfga.js';
import { drizzleSecretStore } from '../../infrastructure/secret-store.js';
import { drizzleUniqueClaims } from '../../infrastructure/unique.js';
import { tenantTransaction, type InTenantTransaction } from '../../infrastructure/unit-of-work.js';
import { recomputeCompleteness, recomputePerson } from '../completeness/recompute.js';
import { uuidv7 } from './ids.js';
import { define, versionOf } from './in-memory.js';
import { exportBuilderView } from '../screens/operations.js';
import {
  inTenantResult,
  personAccess,
  relationsToMany,
  type PlacementChange,
} from './person-access.js';
import type { Viewer } from './ports.js';
import { bringDueIntoForce } from './start.js';

/**
 * PEO-124: a value dated ahead is history at once and in force on its day,
 * on the person's own calendar — over Postgres as `svc_people`, with the
 * outbox relayed to OpenFGA as Debezium would.
 *
 * Kiri works for Acme NZ (Auckland) and Lucy for Acme US (Los Angeles); both
 * report to Aroha. On 24 September HR moves both to Ben from 1 October. At
 * 12:00 UTC on 30 September it is the 1st in Auckland and the 30th in Los
 * Angeles, so Ben manages Kiri from that run and Lucy only from the next one
 * after her midnight — and OpenFGA says so, and not before. Tama's missing
 * cost centre is scheduled, corrected while pending, and makes his record
 * complete on its day. Ria's move to Acme US is a transfer that opens a new
 * employment period on its day.
 */

const ACME = '00000000-0000-4000-8000-00000000000a';
const NZ = '00000000-0000-4000-8000-0000000000e1';
const US = '00000000-0000-4000-8000-0000000000e2';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const AROHA = { person: id(1), account: id(101) };
const BEN = { person: id(2), account: id(102) };
const KIRI = { person: id(3), account: id(103) };
const LUCY = { person: id(4), account: id(104) };
const TAMA = { person: id(5), account: id(105) };
const RIA = { person: id(6), account: id(106) };

let stopPg: (() => Promise<void>) | undefined;
let stopFga: (() => Promise<void>) | undefined;
const clients: ReturnType<typeof postgres>[] = [];
let inTenant: InTenantTransaction;
let fga: OpenFga;
let admin: ReturnType<typeof postgres>;
let handle: (raw: unknown) => Promise<string>;

const ring = staticKeyRing([{ id: 'k1', key: randomBytes(32) }]);
const at = (instant: string) => {
  const clock = fixedClock(instant);
  return personAccess({
    calendars: drizzleOrgStore(),
    people: drizzlePersonRepository(),
    reader: drizzlePersonReader(),
    schemas: drizzleSchemaVersions(),
    relations: drizzleRelations(),
    secrets: drizzleSecretStore(ring),
    uniques: drizzleUniqueClaims(ring),
    numbering: drizzleEmployeeNumbers(),
    clock,
    newId: uuidv7,
    completeness: recomputePerson({
      schema: drizzleSchemaRepository(),
      people: drizzlePeopleFacts(),
      store: drizzleCompletenessStore(),
      clock,
      newEventId: uuidv7,
      calendars: drizzleOrgStore(),
    }),
  });
};
const runAt = (instant: string) =>
  bringDueIntoForce({
    inTenant,
    scheduled: drizzleScheduled(),
    access: at(instant),
    clock: fixedClock(instant),
  })(ACME, uuidv7());

const hr: Viewer = { accountId: id(199), roles: new Set(['hr']) };
const asking = { tenantId: ACME, viewer: hr, correlationId: id(900) };
const TODAY = '2026-09-24T12:00:00.000Z';
const write = (personId: string, changes: Record<string, unknown>, effectiveFrom?: string) =>
  inTenantResult(inTenant, ACME, (tx) =>
    at(TODAY).update(tx, {
      ...asking,
      personId,
      changes,
      ...(effectiveFrom === undefined ? {} : { effectiveFrom }),
    }),
  );
const place = (personId: string, change: PlacementChange) =>
  inTenantResult(inTenant, ACME, (tx) => at(TODAY).place(tx, { ...asking, personId, ...change }));

/** Debezium's job: every outbox row not yet handed over, in order, to the consumer. */
let relayed = 0;
async function relay(): Promise<void> {
  const rows = await admin<{ envelope: unknown }[]>`
    SELECT envelope FROM people.outbox ORDER BY created_at, event_id OFFSET ${relayed}`;
  relayed += rows.length;
  for (const row of rows) await handle(row.envelope);
}

const manages = async (manager: { account: string }, report: { person: string }) =>
  (
    await inTenant(ACME, ({ tx }) =>
      fga.relations.relations(tx, ACME, { accountId: manager.account, roles: new Set() }, report.person),
    )
  ).isManager;

const events = async (personId: string, name: string) =>
  (
    await admin<{ envelope: { effectiveFrom: string | null; payload: Record<string, unknown> } }[]>`
      SELECT envelope FROM people.outbox
       WHERE aggregate_id = ${personId} AND event_name = ${name} ORDER BY created_at, event_id`
  ).map((r) => r.envelope);

const row = async (personId: string) =>
  (
    await admin<Record<string, unknown>[]>`
      SELECT manager_id, legal_entity_id, employee_number, completeness,
             custom->>'cost_centre' AS cost_centre, applied_through::text AS applied_through
        FROM people.person WHERE id = ${personId}::uuid`
  )[0];

beforeAll(async () => {
  const [pg, openfga] = await Promise.all([startPostgres(), startOpenFga()]);
  stopPg = pg.stop;
  stopFga = openfga.stop;

  admin = postgres(pg.url, { max: 1, onnotice: () => {} });
  clients.push(admin);
  const dir = new URL('../../../../../migrations/', import.meta.url);
  const files = (await readdir(dir))
    .filter(
      (f) =>
        f.endsWith('.sql') &&
        ((f.includes('_people_') && !f.includes('identity')) || f.includes('tenant_registry')),
    )
    .sort();
  for (const file of files) {
    await drizzle(admin).execute(sql.raw(await readFile(new URL(file, dir), 'utf8')));
  }
  await admin`ALTER ROLE svc_people LOGIN PASSWORD 'svc_people'`;
  const asService = new URL(pg.url);
  asService.username = 'svc_people';
  asService.password = 'svc_people';
  const serviceClient = postgres(asService.toString(), { max: 4 });
  clients.push(serviceClient);
  inTenant = tenantTransaction(drizzle(serviceClient));

  fga = openFga(openfga.apiUrl);
  handle = peopleConsumer({
    inTenant,
    provisional: drizzleProvisionalPeople({ clock: systemClock, newEventId: uuidv7 }),
    recompute: recomputeCompleteness({
      schema: drizzleSchemaRepository(),
      people: drizzlePeopleFacts(),
      store: drizzleCompletenessStore(),
      clock: systemClock,
      newEventId: uuidv7,
      calendars: drizzleOrgStore(),
    }),
    authz: fga,
  });

  await admin`
    INSERT INTO people.legal_entity (tenant_id, id, name, country, time_zone) VALUES
      (${ACME}::uuid, ${NZ}::uuid, 'Acme NZ', 'NZ', 'Pacific/Auckland'),
      (${ACME}::uuid, ${US}::uuid, 'Acme US', 'US', 'America/Los_Angeles')`;
  await admin`
    INSERT INTO people.employee_numbering (tenant_id, legal_entity_id, prefix, digits, next_value)
    VALUES (${ACME}::uuid, ${US}::uuid, 'US', 4, 7)`;
  const dated = (key: string, over: Parameters<typeof define>[0] = { key }) =>
    define({ ...over, key, effectiveDated: true });
  await inTenant(ACME, ({ tx }) =>
    drizzleSchemaRepository().appendVersion(
      tx,
      ACME,
      versionOf(1, [
        define({ key: 'given_name' }),
        define({ key: 'employee_number' }),
        dated('manager_id', { key: 'manager_id', visibility: ['self', 'manager', 'hr'] }),
        dated('legal_entity_id', {
          key: 'legal_entity_id',
          dataType: 'legal_entity_ref',
          typeConfig: { kind: 'legal_entity_ref' },
        }),
        dated('cost_centre', { key: 'cost_centre', requiredness: { mode: 'always' } }),
      ]),
      [],
      '2024-01-01',
    ),
  );

  const repo = drizzlePersonRepository();
  const seed = (
    who: { person: string; account: string },
    entity: string,
    managerId: string | null,
    custom: Record<string, unknown> = { cost_centre: 'CC-0' },
  ) =>
    inTenant(ACME, ({ tx }) =>
      repo.create(
        tx,
        Person.rehydrate({
          id: who.person,
          tenantId: ACME,
          status: 'active',
          identityAccountId: who.account,
          hireDate: '2024-01-08',
          lastWorkingDay: null,
          employment: {
            period: 1,
            legalEntityId: entity,
            leavingReason: null,
            eligibleForRehire: null,
            noticeFrom: null,
            rehireOverrideReason: null,
            startedOn: '2024-01-08',
          },
        }),
        { managerId, legalEntityId: entity, givenName: who.person.slice(-1), custom, schemaVersion: 1 },
      ),
    );
  await seed(AROHA, NZ, null);
  await seed(BEN, NZ, null);
  await seed(KIRI, NZ, AROHA.person);
  await seed(LUCY, US, AROHA.person);
  await seed(TAMA, NZ, null, {});
  await seed(RIA, NZ, null);
  await admin`
    INSERT INTO people.employment_period (tenant_id, person_id, period, legal_entity_id, started_on)
    VALUES (${ACME}::uuid, ${RIA.person}::uuid, 1, ${NZ}::uuid, '2024-01-08')
    ON CONFLICT DO NOTHING`;
  for (const who of [AROHA, BEN, KIRI, LUCY, TAMA, RIA]) {
    await inTenant(ACME, ({ tx }) => fga.sync(tx, ACME, who.person));
  }
  // Tama has no cost centre: incomplete from the start.
  await inTenant(ACME, ({ tx }) =>
    recomputePerson({
      schema: drizzleSchemaRepository(),
      people: drizzlePeopleFacts(),
      store: drizzleCompletenessStore(),
      clock: fixedClock(TODAY),
      newEventId: uuidv7,
      calendars: drizzleOrgStore(),
    })(tx, {
      tenantId: ACME,
      personId: TAMA.person,
      actor: { kind: 'system', process: 'test' },
      correlationId: id(901),
      causationId: null,
    }),
  );
  await relay();
}, 180_000);

afterAll(async () => {
  for (const c of clients) await c.end();
  await Promise.all([stopPg?.(), stopFga?.()]);
});

describe('a manager change dated next week', () => {
  it('is recorded and scheduled, and moves nobody yet', async () => {
    expect((await write(KIRI.person, { manager_id: BEN.person }, '2026-10-01')).ok).toBe(true);
    expect((await write(LUCY.person, { manager_id: BEN.person }, '2026-10-01')).ok).toBe(true);
    await relay();

    // The update is told now, dated ahead: a consumer sees it is scheduled.
    expect((await events(KIRI.person, 'people.person.profile_updated')).at(-1)).toMatchObject({
      effectiveFrom: '2026-10-01',
    });
    expect(await events(KIRI.person, 'people.person.manager_changed')).toEqual([]);
    expect(await row(KIRI.person)).toMatchObject({ manager_id: AROHA.person });
    expect(await manages(BEN, KIRI)).toBe(false);
    expect(await manages(AROHA, KIRI)).toBe(true);
  });

  it('comes into force at Auckland’s midnight, and not yet in Los Angeles', async () => {
    // 12:00 UTC on 30 September: 1 October 01:00 in Auckland, 05:00 on the 30th in LA.
    const run = await runAt('2026-09-30T12:00:00.000Z');
    expect(run.failed).toEqual([]);
    expect(run.applied).toBe(1);
    await relay();

    expect(await row(KIRI.person)).toMatchObject({ manager_id: BEN.person, applied_through: '2026-10-01' });
    expect(await row(LUCY.person)).toMatchObject({ manager_id: AROHA.person });
    expect(await manages(BEN, KIRI)).toBe(true);
    expect(await manages(AROHA, KIRI)).toBe(false);
    expect(await manages(BEN, LUCY)).toBe(false);

    expect(await events(KIRI.person, 'people.person.attribute_effective')).toEqual([
      expect.objectContaining({
        effectiveFrom: '2026-10-01',
        payload: expect.objectContaining({
          personId: KIRI.person,
          changed: [expect.objectContaining({ key: 'manager_id' })],
        }) as unknown,
      }),
    ]);
    expect(await events(KIRI.person, 'people.person.manager_changed')).toEqual([
      expect.objectContaining({
        effectiveFrom: '2026-10-01',
        payload: { personId: KIRI.person, previousManagerId: AROHA.person, managerId: BEN.person },
      }),
    ]);
  });

  it('does nothing twice on a rerun', async () => {
    const before = (await admin`SELECT count(*)::int AS n FROM people.outbox`)[0]?.['n'];
    expect(await runAt('2026-09-30T12:30:00.000Z')).toEqual({ applied: 0, failed: [] });
    expect((await admin`SELECT count(*)::int AS n FROM people.outbox`)[0]?.['n']).toBe(before);
  });

  it('comes into force in Los Angeles after its own midnight', async () => {
    // 08:00 UTC on 1 October: 01:00 in Los Angeles.
    expect(await runAt('2026-10-01T08:00:00.000Z')).toMatchObject({ applied: 1, failed: [] });
    await relay();
    expect(await row(LUCY.person)).toMatchObject({ manager_id: BEN.person });
    expect(await manages(BEN, LUCY)).toBe(true);
  });
});

describe('a correction to a pending value, and completeness on the day', () => {
  it('supersedes what was scheduled, and completes the record on its day', async () => {
    expect((await write(TAMA.person, { cost_centre: 'CC-1' }, '2026-10-05')).ok).toBe(true);
    const history = await inTenant(ACME, ({ tx }) =>
      at(TODAY).history(tx, { ...asking, personId: TAMA.person, attributeKey: 'cost_centre' }),
    );
    const pending = history.ok ? history.value.find((e) => e.value === 'CC-1') : undefined;
    expect(pending).toBeDefined();
    const fixed = await inTenantResult(inTenant, ACME, (tx) =>
      at(TODAY).correct(tx, {
        ...asking,
        personId: TAMA.person,
        supersedes: pending?.id ?? '',
        value: 'CC-2',
        reason: 'Wrong cost centre',
      }),
    );
    expect(fixed.ok).toBe(true);
    // Still nothing in force: incomplete until the 5th.
    expect(await row(TAMA.person)).toMatchObject({ cost_centre: null, completeness: 'incomplete' });

    // Midnight on the 5th in Auckland is 11:00 UTC on the 4th.
    expect(await runAt('2026-10-04T10:00:00.000Z')).toMatchObject({ applied: 0 });
    expect(await runAt('2026-10-04T12:00:00.000Z')).toMatchObject({ applied: 1, failed: [] });
    expect(await row(TAMA.person)).toMatchObject({ cost_centre: 'CC-2', completeness: 'complete' });
    expect(await events(TAMA.person, 'people.person.profile_completed')).toHaveLength(1);
  });
});

describe('a future move to another legal entity', () => {
  it('is accepted, and opens the new employment period on its day', async () => {
    const placed = await place(RIA.person, { legalEntityId: US, effectiveFrom: '2026-10-10' });
    expect(placed.ok).toBe(true);
    // A retry of the same schedule is answered with the record, not a correction.
    expect((await place(RIA.person, { legalEntityId: US, effectiveFrom: '2026-10-10' })).ok).toBe(true);
    expect(await events(RIA.person, 'people.person.attribute_corrected')).toEqual([]);

    const periods = async () =>
      (
        await admin<{ period: number; legal_entity_id: string; started_on: string; last_working_day: string | null }[]>`
          SELECT period, legal_entity_id, started_on::text, last_working_day::text
            FROM people.employment_period WHERE person_id = ${RIA.person}::uuid ORDER BY period`
      ).map((p) => [p.period, p.legal_entity_id, p.started_on, p.last_working_day]);
    expect(await periods()).toEqual([[1, NZ, '2024-01-08', null]]);
    expect(await row(RIA.person)).toMatchObject({ legal_entity_id: NZ });

    // Judged on the calendar it takes her to: 12:00 UTC on the 10th is 05:00 there.
    expect(await runAt('2026-10-10T12:00:00.000Z')).toMatchObject({ applied: 1, failed: [] });
    expect(await periods()).toEqual([
      [1, NZ, '2024-01-08', '2026-10-09'],
      [2, US, '2026-10-10', null],
    ]);
    expect(await row(RIA.person)).toMatchObject({ legal_entity_id: US, employee_number: 'US0007' });
    expect((await events(RIA.person, 'people.person.org_changed')).at(-1)).toMatchObject({
      effectiveFrom: '2026-10-10',
      payload: { legalEntityId: US },
    });
  });
});

describe('a value dated in the past', () => {
  it('is in force at once, as before, and leaves the job nothing to do', async () => {
    expect((await write(LUCY.person, { cost_centre: 'CC-9' }, '2026-09-01')).ok).toBe(true);
    expect(await row(LUCY.person)).toMatchObject({ cost_centre: 'CC-9' });
    expect(await runAt('2026-10-12T12:00:00.000Z')).toEqual({ applied: 0, failed: [] });
  });
});

describe('who a viewer is to many people, in a handful of questions', () => {
  it('matches one check per person, from OpenFGA and from the rows alike', async () => {
    const everybody = [AROHA, BEN, KIRI, LUCY, TAMA, RIA].map((p) => p.person);
    const ben: Viewer = { accountId: BEN.account, roles: new Set() };
    for (const resolver of [fga.relations, drizzleRelations()]) {
      const reach = await inTenant(ACME, async ({ tx }) => resolver.reach?.(tx, ACME, ben));
      expect(reach).toMatchObject({ self: new Set([BEN.person]), complete: true });
      expect(reach?.direct).toEqual(new Set([KIRI.person, LUCY.person]));
      const many = await inTenant(ACME, ({ tx }) =>
        relationsToMany(resolver, tx, ACME, ben, everybody),
      );
      for (const person of everybody) {
        const one = await inTenant(ACME, ({ tx }) => resolver.relations(tx, ACME, ben, person));
        expect(many.get(person), person).toEqual(one);
      }
    }
  });

  it('offers the export builder’s fields from the schema and the viewer’s relations, not a sample', async () => {
    const deps = {
      service: { access: at(TODAY), schemas: drizzleSchemaVersions(), inTenant },
      relations: fga.relations,
      clock: fixedClock(TODAY),
      personOf: drizzlePersonReader().personOf,
      calendars: drizzleOrgStore(),
      gapTotals: drizzleGapTotals(),
    };
    const offered = async (viewer: Viewer) => {
      const view = await exportBuilderView(deps, { tenantId: ACME, viewer, correlationId: id(902) });
      if (!view.ok) throw new Error(view.error.code);
      return {
        count: view.value.who[0]?.count,
        keys: view.value.sections.flatMap((s) => s.fields.map((f) => f.key)),
      };
    };
    // Ben manages two people, so their manager is his to export.
    const ben = await offered({ accountId: BEN.account, roles: new Set() });
    expect(ben.count).toBe(6);
    expect(ben.keys).toContain('manager_id');
    // An account with no record and nobody to manage reads no manager.
    const stranger = await offered({ accountId: id(150), roles: new Set() });
    expect(stranger.keys).not.toContain('manager_id');
  });
});
