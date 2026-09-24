import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { fixedClock, systemClock } from '@kithena/domain-kit';
import { startPostgres } from '@kithena/testing';

import { drizzlePersonRepository } from '../../infrastructure/drizzle-person-repository.js';
import {
  drizzleLeavers,
  drizzlePersonReader,
  drizzleRelations,
  drizzleSchemaVersions,
} from '../../infrastructure/drizzle-person-reader.js';
import { drizzleRoleStore } from '../../infrastructure/drizzle-role-store.js';
import { drizzleSchemaRepository } from '../../infrastructure/drizzle-schema-repository.js';
import { staticKeyRing } from '../../infrastructure/envelope.js';
import { drizzleSecretStore } from '../../infrastructure/secret-store.js';
import { drizzleUniqueClaims } from '../../infrastructure/unique.js';
import { tenantTransaction, type InTenantTransaction } from '../../infrastructure/unit-of-work.js';
import { fixedCalendars } from '../org/org.js';
import { uuidv7 } from '../person/ids.js';
import { define, versionOf } from '../person/in-memory.js';
import { inTenantResult, personAccess } from '../person/person-access.js';
import { endAccessDue } from '../person/start.js';
import { tenantRoles, type TenantRoles } from './roles.js';

/**
 * A leaver's tenant roles end with their access (PEO-109 × PEO-112), over
 * Postgres as `svc_people`.
 *
 * Kiri (finance, hr) worked her notice to 30 September and the hourly job
 * ends her access at Auckland's midnight; Marco (people_admin) is dismissed for cause and HR
 * ends his access at once. In another company Sole is the only People
 * administrator, and leaves too: the trigger that keeps an administrator lets
 * a leaver's grant go (20260924280000), and refuses it for anybody else.
 */

const ACME = '00000000-0000-4000-8000-00000000000a';
const SOLO = '00000000-0000-4000-8000-00000000000b';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const PRIYA = { person: id(1), account: id(101) };
const KIRI = { person: id(2), account: id(102) };
const MARCO = { person: id(3), account: id(103) };
const SOLE = { person: id(4), account: id(104) };
const CORRELATION = '00000000-0000-4000-8000-00000000c0de';

const calendars = fixedCalendars({
  defaultZone: 'Pacific/Auckland',
  entities: new Map(),
  locations: new Map(),
});
const ring = staticKeyRing([{ id: 'k1', key: randomBytes(32) }]);

let stop: (() => Promise<void>) | undefined;
let admin: ReturnType<typeof postgres>;
let service: ReturnType<typeof postgres>;
let inTenant: InTenantTransaction;
let roles: TenantRoles;

const job = (tenantId: string, at: string) =>
  endAccessDue({
    inTenant,
    leavers: drizzleLeavers(),
    people: drizzlePersonRepository(),
    reader: drizzlePersonReader(),
    calendars,
    clock: fixedClock(at),
    newId: uuidv7,
    roles,
  })(tenantId, CORRELATION);

const accessAt = (at: string) =>
  personAccess({
    calendars,
    people: drizzlePersonRepository(),
    reader: drizzlePersonReader(),
    schemas: drizzleSchemaVersions(),
    relations: drizzleRelations(),
    secrets: drizzleSecretStore(ring),
    uniques: drizzleUniqueClaims(ring),
    clock: fixedClock(at),
    newId: uuidv7,
    roles,
  });

const held = async (tenantId: string, account: string) =>
  (await inTenant(tenantId, ({ tx }) => roles.of(tx, tenantId, account))).roles;

const revoked = async (account: string) =>
  (
    await admin<{ actor: unknown; payload: Record<string, unknown> }[]>`
      SELECT envelope -> 'actor' AS actor, envelope -> 'payload' AS payload FROM people.outbox
       WHERE event_name = 'people.role.revoked' AND envelope -> 'payload' ->> 'accountId' = ${account}
       ORDER BY envelope -> 'payload' ->> 'role'`
  ).map((r) => ({ actor: r.actor, payload: r.payload }));

const system = (account: string, role: string) => ({
  actor: { kind: 'system', process: 'people.roles' },
  payload: { accountId: account, role, by: null, via: 'system', reason: 'access_ended' },
});

beforeAll(async () => {
  const pg = await startPostgres();
  stop = pg.stop;
  admin = postgres(pg.url, { max: 1, onnotice: () => {} });
  const dir = new URL('../../../../../migrations/', import.meta.url);
  for (const file of (await readdir(dir))
    .filter(
      (f) =>
        f.endsWith('.sql') &&
        ((f.includes('_people_') && !f.includes('identity')) || f.includes('tenant_registry')),
    )
    .sort()) {
    await admin.unsafe(await readFile(new URL(file, dir), 'utf8'));
  }
  await admin`ALTER ROLE svc_people LOGIN PASSWORD 'svc_people'`;
  const url = new URL(pg.url);
  url.username = 'svc_people';
  url.password = 'svc_people';
  service = postgres(url.toString(), { max: 4 });
  inTenant = tenantTransaction(drizzle(service));
  roles = tenantRoles({ store: drizzleRoleStore(), clock: systemClock, newId: uuidv7 });

  for (const tenant of [ACME, SOLO]) {
    await inTenant(tenant, ({ tx }) =>
      drizzleSchemaRepository().appendVersion(
        tx,
        tenant,
        versionOf(1, [define({ key: 'job_title' })]),
        [],
        '2026-09-01',
      ),
    );
  }
  for (const [tenant, who, status, lastDay] of [
    [ACME, PRIYA, 'active', null],
    [ACME, KIRI, 'notice', '2026-09-30'],
    [ACME, MARCO, 'notice', '2026-12-31'],
    [SOLO, SOLE, 'notice', '2026-09-30'],
  ] as const) {
    await admin`INSERT INTO people.person (tenant_id, id, status, identity_account_id, hire_date,
                  last_working_day, given_name, family_name, work_email, schema_version)
                VALUES (${tenant}, ${who.person}, ${status}, ${who.account}, '2025-01-01',
                  ${lastDay}, 'Given', 'Family', 'x@acme.test', 1)`;
  }

  const named = (tenantId: string, accountId: string) =>
    inTenant(tenantId, ({ tx }) =>
      roles.administratorNamed(tx, {
        tenantId,
        accountId,
        correlationId: CORRELATION,
        causationId: null,
      }),
    );
  await named(ACME, PRIYA.account);
  await named(ACME, MARCO.account);
  await named(SOLO, SOLE.account);
  for (const role of ['finance', 'hr'] as const) {
    const granted = await inTenant(ACME, ({ tx }) =>
      roles.grant(tx, {
        tenantId: ACME,
        viewer: { accountId: PRIYA.account, roles: new Set() },
        correlationId: CORRELATION,
        accountId: KIRI.account,
        role,
        reason: 'Covers payroll',
      }),
    );
    expect(granted.ok).toBe(true);
  }
}, 180_000);

afterAll(async () => {
  // Missing when `beforeAll` failed, which is then the only error worth reading.
  await (service as typeof admin | undefined)?.end();
  await (admin as typeof admin | undefined)?.end();
  await stop?.();
});

describe('the hourly job ending a leaver’s access', () => {
  it('revokes every role they held, as the system, with the reason access_ended', async () => {
    expect(await held(ACME, KIRI.account)).toEqual(['hr', 'finance']);
    expect(await job(ACME, '2026-09-30T11:30:00.000Z')).toMatchObject({ ended: 1, failed: [] });

    expect(await held(ACME, KIRI.account)).toEqual([]);
    expect(await revoked(KIRI.account)).toEqual([
      system(KIRI.account, 'finance'),
      system(KIRI.account, 'hr'),
    ]);
  });

  it('revokes nothing more on a later run, and grants nothing back', async () => {
    expect(await job(ACME, '2026-10-02T11:30:00.000Z')).toMatchObject({ ended: 0 });
    expect(await held(ACME, KIRI.account)).toEqual([]);
    expect(await revoked(KIRI.account)).toHaveLength(2);
  });
});

describe('HR ending access at once', () => {
  it('revokes the dismissed person’s roles in the same transaction', async () => {
    const dismissed = await inTenantResult(inTenant, ACME, (tx) =>
      accessAt('2026-09-30T19:00:00.000Z').terminate(tx, {
        tenantId: ACME,
        viewer: { accountId: PRIYA.account, roles: new Set(['hr']) },
        correlationId: CORRELATION,
        personId: MARCO.person,
        lastWorkingDay: '2026-09-30',
        reason: 'dismissed',
        eligibleForRehire: false,
        endAccessNow: true,
      }),
    );
    expect(dismissed.ok).toBe(true);
    expect(await held(ACME, MARCO.account)).toEqual([]);
    expect(await revoked(MARCO.account)).toEqual([
      system(MARCO.account, 'hr'),
      system(MARCO.account, 'people_admin'),
    ]);
    // Priya still administers; nobody else lost anything.
    expect(await held(ACME, PRIYA.account)).toEqual(['hr', 'people_admin']);
  });
});

describe('the last People administrator leaving', () => {
  it('is still refused for somebody whose access has not ended', async () => {
    await expect(
      service.begin(async (tx) => {
        await tx`SELECT set_config('app.tenant_id', ${SOLO}, true)`;
        await tx`DELETE FROM people.role_grant WHERE account_id = ${SOLE.account} AND role = 'people_admin'`;
      }),
    ).rejects.toThrow(/last people_admin/);
    expect(await held(SOLO, SOLE.account)).toEqual(['hr', 'people_admin']);
  });

  it('loses the grant with their access, leaving the back office to name another', async () => {
    expect(await job(SOLO, '2026-09-30T11:30:00.000Z')).toMatchObject({ ended: 1, failed: [] });
    expect(await held(SOLO, SOLE.account)).toEqual([]);
    expect(await revoked(SOLE.account)).toEqual([
      system(SOLE.account, 'hr'),
      system(SOLE.account, 'people_admin'),
    ]);
  });
});
