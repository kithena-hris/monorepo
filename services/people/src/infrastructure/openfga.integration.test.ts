import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { systemClock } from '@kithena/domain-kit';
import { logger } from '@kithena/telemetry';
import { startOpenFga, startPostgres } from '@kithena/testing';

import { define, versionOf } from '../application/person/in-memory.js';
import { personAccess, type PersonAccess } from '../application/person/person-access.js';
import { uuidv7 } from '../application/person/ids.js';
import { recomputeCompleteness } from '../application/completeness/recompute.js';
import { utcCalendars } from '../application/org/org.js';
import { tenantRoles, type TenantRoles } from '../application/roles/roles.js';
import { drizzleRoleStore } from './drizzle-role-store.js';
import { Person } from '../domain/person/person.js';
import { peopleConsumer } from './consumers/handle.js';
import { drizzleProvisionalPeople } from './consumers/identity.js';
import { drizzleCompletenessStore } from './drizzle-completeness-store.js';
import { drizzlePersonReader, drizzleSchemaVersions } from './drizzle-person-reader.js';
import { drizzlePersonRepository } from './drizzle-person-repository.js';
import { drizzlePeopleFacts, drizzleSchemaRepository } from './drizzle-schema-repository.js';
import { keysFrom, staticKeyRing } from './envelope.js';
import { openFga, type OpenFga } from './openfga.js';
import { drizzleSecretStore } from './secret-store.js';
import { drizzleUniqueClaims } from './unique.js';
import { tenantTransaction, type InTenantTransaction } from './unit-of-work.js';

/**
 * PEO-092 against a real OpenFGA: the model, the tuples People's own events
 * write, and the relations the application reads back.
 *
 *   Boss ─▶ Manager ─▶ Employee         (Acme)
 *   Other manager                       (Acme)
 *   HR at Globex                        (Globex)
 *
 * Nobody administers a tenant for arriving first (PEO-112): the back office
 * names Boss for Acme and Globex's HR for Globex, and every later role is
 * granted through People's application layer and reaches OpenFGA through the
 * outbox.
 */

const ACME = '00000000-0000-4000-8000-00000000000a';
const GLOBEX = '00000000-0000-4000-8000-00000000000b';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const BOSS = { person: id(1), account: id(101) };
const MANAGER = { person: id(2), account: id(102) };
const EMPLOYEE = { person: id(3), account: id(103) };
const OTHER = { person: id(4), account: id(104) };
const GLOBEX_HR = { person: id(5), account: id(105) };

const viewer = (accountId: string) => ({ accountId, roles: new Set<string>() });

let stopPg: (() => Promise<void>) | undefined;
let stopFga: (() => Promise<void>) | undefined;
const clients: ReturnType<typeof postgres>[] = [];
let inTenant: InTenantTransaction;
let fga: OpenFga;
let access: PersonAccess;
let handle: (raw: unknown) => Promise<string>;
let admin: ReturnType<typeof postgres>;
let roles: TenantRoles;

/** The back office naming a People administrator, as identity's outbox writes it. */
const named = (tenantId: string, accountId: string, n: number) => ({
  eventId: `01890000-0000-7000-8000-${String(n).padStart(12, '0')}`,
  eventName: 'identity.tenant.administrator_named',
  eventVersion: 1,
  tenantId,
  occurredAt: '2026-09-24T09:00:00.000Z',
  recordedAt: '2026-09-24T09:00:00.000Z',
  effectiveFrom: null,
  aggregate: { type: 'Tenant', id: tenantId, version: 1 },
  actor: { kind: 'system', process: 'name-administrator' },
  correlationId: '00000000-0000-4000-8000-00000000c0de',
  causationId: null,
  payload: { entitlement: 'module.people', accountId, namedBy: null },
});

/** The back office taking one back: the same envelope, the reverse event. */
const removed = (tenantId: string, accountId: string, n: number) => ({
  ...named(tenantId, accountId, n),
  eventName: 'identity.tenant.administrator_removed',
  payload: { entitlement: 'module.people', accountId, removedBy: null },
});

const relations = (tenantId: string, accountId: string, personId: string) =>
  inTenant(tenantId, ({ tx }) =>
    fga.relations.relations(tx, tenantId, viewer(accountId), personId),
  );

/** Debezium's job: every outbox row not yet handed over, in order, to the consumer. */
let relayed = 0;
async function relay(): Promise<void> {
  const rows = await admin<{ envelope: unknown }[]>`
    SELECT envelope FROM people.outbox ORDER BY created_at, event_id OFFSET ${relayed}`;
  relayed += rows.length;
  for (const row of rows) await handle(row.envelope);
}

beforeAll(async () => {
  const [pg, openfga] = await Promise.all([startPostgres(), startOpenFga()]);
  stopPg = pg.stop;
  stopFga = openfga.stop;

  admin = postgres(pg.url, { max: 1, onnotice: () => {} });
  clients.push(admin);
  const dir = new URL('../../../../migrations/', import.meta.url);
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
  const serviceClient = postgres(asService.toString(), { max: 2 });
  clients.push(serviceClient);
  inTenant = tenantTransaction(drizzle(serviceClient));

  fga = openFga(openfga.apiUrl);
  roles = tenantRoles({ store: drizzleRoleStore(), clock: systemClock, newId: uuidv7 });
  handle = peopleConsumer({
    roles,
    inTenant,
    provisional: drizzleProvisionalPeople({ clock: systemClock, newEventId: uuidv7 }),
    recompute: recomputeCompleteness({
      schema: drizzleSchemaRepository(),
      people: drizzlePeopleFacts(),
      store: drizzleCompletenessStore(),
      clock: systemClock,
      newEventId: uuidv7,
      calendars: utcCalendars,
    }),
    authz: fga,
  });
  access = personAccess({
    people: drizzlePersonRepository(),
    reader: drizzlePersonReader(),
    schemas: drizzleSchemaVersions(),
    relations: fga.relations,
    secrets: drizzleSecretStore(
      staticKeyRing(keysFrom(`k1:${randomBytes(32).toString('base64')}`)),
      logger,
    ),
    uniques: drizzleUniqueClaims(
      staticKeyRing(keysFrom(`k1:${randomBytes(32).toString('base64')}`)),
    ),
    clock: systemClock,
    newId: uuidv7,
    calendars: utcCalendars,
  });

  const repo = drizzlePersonRepository();
  const seed = (
    tenantId: string,
    who: { person: string; account: string },
    managerId: string | null,
  ) =>
    inTenant(tenantId, ({ tx }) =>
      repo.create(
        tx,
        Person.rehydrate({
          id: who.person,
          tenantId,
          status: 'active',
          identityAccountId: who.account,
          hireDate: '2026-01-01',
          lastWorkingDay: null,
        }),
        { managerId },
      ),
    );
  // Boss first, which used to make Boss the administrator; it no longer does.
  await seed(ACME, BOSS, null);
  await seed(ACME, MANAGER, BOSS.person);
  await seed(ACME, EMPLOYEE, MANAGER.person);
  await seed(ACME, OTHER, null);
  await seed(GLOBEX, GLOBEX_HR, null);
  await inTenant(ACME, ({ tx }) =>
    drizzleSchemaRepository().appendVersion(
      tx,
      ACME,
      versionOf(1, [define({ key: 'manager_id', visibility: ['self', 'manager', 'hr'] })]),
      [],
      '2026-09-01',
    ),
  );

  // What the hire path would have raised; seeding bypasses it, so the
  // consumer is asked directly, the way a replay from the beginning would.
  for (const [tenantId, who] of [
    [ACME, BOSS],
    [ACME, MANAGER],
    [ACME, EMPLOYEE],
    [ACME, OTHER],
    [GLOBEX, GLOBEX_HR],
  ] as const) {
    await inTenant(tenantId, ({ tx }) => fga.sync(tx, tenantId, who.person));
  }
  expect(await fga.roles(ACME, BOSS.account)).toEqual(new Set());

  // The back office names each tenant's administrator (PEO-112).
  expect(await handle(named(ACME, BOSS.account, 1))).toBe('applied');
  expect(await handle(named(ACME, BOSS.account, 1))).toBe('unchanged');
  expect(await handle(named(GLOBEX, GLOBEX_HR.account, 2))).toBe('applied');
  await relay();
}, 180_000);

afterAll(async () => {
  for (const c of clients) await c.end();
  await Promise.all([stopPg?.(), stopFga?.()]);
});

describe('OpenFGA relations for People', () => {
  it('answers self, manager and a transitive chain from two tuples a person', async () => {
    expect(await relations(ACME, EMPLOYEE.account, EMPLOYEE.person)).toMatchObject({
      isSelf: true,
      isManager: false,
    });
    expect(await relations(ACME, MANAGER.account, EMPLOYEE.person)).toMatchObject({
      isManager: true,
      isInManagerChain: true,
    });
    // Two levels up: in the chain, and not the direct manager.
    expect(await relations(ACME, BOSS.account, EMPLOYEE.person)).toMatchObject({
      isSelf: false,
      isManager: false,
      isInManagerChain: true,
    });
    // Down the chain is not up it.
    expect(await relations(ACME, EMPLOYEE.account, BOSS.person)).toMatchObject({
      isManager: false,
      isInManagerChain: false,
    });
  });

  it('revokes the old chain when a manager change flows through the outbox', async () => {
    const moved = await inTenant(ACME, ({ tx }) =>
      access.update(tx, {
        tenantId: ACME,
        viewer: viewer(BOSS.account),
        correlationId: uuidv7(),
        personId: EMPLOYEE.person,
        changes: { manager_id: OTHER.person },
      }),
    );
    expect(moved.ok).toBe(true);
    await relay();

    const outbox = await admin<{ event_name: string }[]>`
      SELECT event_name FROM people.outbox WHERE event_name = 'people.person.manager_changed'`;
    expect(outbox).toHaveLength(1);

    expect(await relations(ACME, OTHER.account, EMPLOYEE.person)).toMatchObject({
      isManager: true,
      isInManagerChain: true,
    });
    expect(await relations(ACME, MANAGER.account, EMPLOYEE.person)).toMatchObject({
      isManager: false,
      isInManagerChain: false,
    });
    // Boss reached Employee only through Manager; Other reports to nobody.
    expect(await relations(ACME, BOSS.account, EMPLOYEE.person)).toMatchObject({
      isInManagerChain: false,
    });
  });

  it('is idempotent: redelivering every event changes nothing', async () => {
    relayed = 0;
    await relay();
    const again = await inTenant(ACME, ({ tx }) => fga.sync(tx, ACME, EMPLOYEE.person));
    expect(again).toBe('unchanged');
  });

  it('scopes HR to its own tenant', async () => {
    expect(await relations(ACME, BOSS.account, OTHER.person)).toMatchObject({
      isHr: true,
      isAdmin: true,
    });
    expect(await relations(GLOBEX, GLOBEX_HR.account, GLOBEX_HR.person)).toMatchObject({
      isHr: true,
    });
    // Globex's HR asking about Acme, as Acme: nothing tenant-wide.
    expect(await relations(ACME, GLOBEX_HR.account, EMPLOYEE.person)).toMatchObject({
      isHr: false,
      isAdmin: false,
      isFinance: false,
      isInManagerChain: false,
    });
    // The roles every other check reads come from the same tuples.
    expect([...(await fga.roles(ACME, BOSS.account))].toSorted()).toEqual(['hr', 'people_admin']);
    expect(await fga.roles(GLOBEX, BOSS.account)).toEqual(new Set());
    // And the second person in a tenant is not its administrator.
    expect(await relations(ACME, MANAGER.account, OTHER.person)).toMatchObject({
      isHr: false,
      isAdmin: false,
    });
  });

  it('takes a leaver out of their reports’ chain, and grants and revokes a role', async () => {
    await admin`UPDATE people.person SET status = 'terminated', last_working_day = '2026-09-01'
                       WHERE id = ${OTHER.person}`;
    await inTenant(ACME, ({ tx }) => fga.sync(tx, ACME, OTHER.person));
    expect(await relations(ACME, OTHER.account, EMPLOYEE.person)).toMatchObject({
      isManager: false,
    });

    const asBoss = {
      tenantId: ACME,
      viewer: { accountId: BOSS.account, roles: new Set<string>() },
      correlationId: '00000000-0000-4000-8000-00000000c0df',
    };
    const change = { accountId: MANAGER.account, role: 'finance' as const, reason: 'Runs payroll' };
    const grant = () => inTenant(ACME, ({ tx }) => roles.grant(tx, { ...asBoss, ...change }));
    expect((await grant()).ok).toBe(true);
    expect((await grant()).ok).toBe(true);
    await relay();
    expect((await relations(ACME, MANAGER.account, OTHER.person)).isFinance).toBe(true);
    expect(
      await admin`SELECT count(*)::int AS n FROM people.outbox WHERE event_name = 'people.role.granted'
                  AND envelope -> 'payload' ->> 'role' = 'finance'`,
    ).toEqual([{ n: 1 }]);

    expect((await inTenant(ACME, ({ tx }) => roles.revoke(tx, { ...asBoss, ...change }))).ok).toBe(
      true,
    );
    await relay();
    expect((await relations(ACME, MANAGER.account, OTHER.person)).isFinance).toBe(false);
  });
  it('grants a second named administrator and revokes them when the back office removes them', async () => {
    expect(await handle(named(ACME, MANAGER.account, 3))).toBe('applied');
    await relay();
    expect(await fga.roles(ACME, MANAGER.account)).toEqual(new Set(['people_admin', 'hr']));

    expect(await handle(removed(ACME, MANAGER.account, 4))).toBe('applied');
    expect(await handle(removed(ACME, MANAGER.account, 4))).toBe('unchanged');
    await relay();
    expect(await fga.roles(ACME, MANAGER.account)).toEqual(new Set());

    // Never the last people_admin: the company would have nobody to grant anything.
    expect(await handle(removed(ACME, BOSS.account, 5))).toBe('unchanged');
    expect((await fga.roles(ACME, BOSS.account)).has('people_admin')).toBe(true);
  });
});
