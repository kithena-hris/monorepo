import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { systemClock } from '@kithena/domain-kit';
import { startPostgres } from '@kithena/testing';

import { uuidv7 } from '../person/ids.js';
import { drizzleRoleStore } from '../../infrastructure/drizzle-role-store.js';
import { tenantTransaction, type InTenantTransaction } from '../../infrastructure/unit-of-work.js';
import { tenantRoles, type TenantRoles } from './roles.js';

/**
 * PEO-112 against Postgres: the rules under the tenant's role lock, the
 * trigger that backs the last-administrator rule for any path that skips the
 * application, the audited events, and the carry-over of what the old
 * first-person rule granted.
 */

const ACME = '00000000-0000-4000-8000-00000000000a';
const LEGACY = '00000000-0000-4000-8000-00000000000c';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const PRIYA = { person: id(1), account: id(101) };
const MARCO = { person: id(2), account: id(102) };
const ADAM = { person: id(3), account: id(103) };
const LEFT = { person: id(4), account: id(104) };

let stop: (() => Promise<void>) | undefined;
let admin: ReturnType<typeof postgres>;
let service: ReturnType<typeof postgres>;
let inTenant: InTenantTransaction;
let roles: TenantRoles;

const as = (account: string) => ({
  tenantId: ACME,
  viewer: { accountId: account, roles: new Set<string>() },
  correlationId: '00000000-0000-4000-8000-00000000c0de',
});

const grant = (by: string, accountId: string, role: 'hr' | 'finance' | 'people_admin') =>
  inTenant(ACME, ({ tx }) => roles.grant(tx, { ...as(by), accountId, role, reason: 'Needed' }));
const revoke = (by: string, accountId: string, role: 'hr' | 'finance' | 'people_admin') =>
  inTenant(ACME, ({ tx }) => roles.revoke(tx, { ...as(by), accountId, role, reason: 'Moved on' }));

const person = (
  tenant: string,
  who: { person: string; account: string },
  status: string,
  at: string,
) =>
  admin`INSERT INTO people.person (id, tenant_id, identity_account_id, status, given_name, family_name, work_email, created_at)
        VALUES (${who.person}, ${tenant}, ${who.account}, ${status}, 'Given', ${who.person.slice(-3)}, 'x@acme.example', ${at})`;

beforeAll(async () => {
  const pg = await startPostgres();
  stop = pg.stop;
  admin = postgres(pg.url, { max: 1, onnotice: () => {} });
  const dir = new URL('../../../../../migrations/', import.meta.url);
  const files = (await readdir(dir))
    .filter(
      (f) =>
        f.endsWith('.sql') &&
        ((f.includes('_people_') && !f.includes('identity')) || f.includes('tenant_registry')),
    )
    .sort();
  const roleMigration = files.find((f) => f.includes('people_role_grant')) ?? '';
  // Anything after the role migration amends it, so it runs after it too.
  const later = files.filter((f) => f > roleMigration);
  for (const file of files.filter((f) => f < roleMigration)) {
    await admin.unsafe(await readFile(new URL(file, dir), 'utf8'));
  }

  // A tenant from before PEO-112: its first person was made its administrator.
  await person(LEGACY, { person: id(9), account: id(109) }, 'active', '2026-01-01');
  await person(LEGACY, { person: id(10), account: id(110) }, 'active', '2026-01-02');
  await admin.unsafe(await readFile(new URL(roleMigration, dir), 'utf8'));
  for (const file of later) await admin.unsafe(await readFile(new URL(file, dir), 'utf8'));

  for (const [who, status, at] of [
    [PRIYA, 'active', '2026-02-01'],
    [MARCO, 'active', '2026-02-02'],
    [ADAM, 'active', '2026-02-03'],
    [LEFT, 'terminated', '2026-02-04'],
  ] as const) {
    await person(ACME, who, status, at);
  }

  await admin`ALTER ROLE svc_people LOGIN PASSWORD 'svc_people'`;
  const url = new URL(pg.url);
  url.username = 'svc_people';
  url.password = 'svc_people';
  service = postgres(url.toString(), { max: 4 });
  inTenant = tenantTransaction(drizzle(service));
  roles = tenantRoles({ store: drizzleRoleStore(), clock: systemClock, newId: uuidv7 });

  // The back office names Priya (PEO-112).
  await inTenant(ACME, ({ tx }) =>
    roles.administratorNamed(tx, {
      tenantId: ACME,
      accountId: PRIYA.account,
      correlationId: '00000000-0000-4000-8000-00000000c0de',
      causationId: null,
    }),
  );
}, 180_000);

afterAll(async () => {
  await service.end();
  await admin.end();
  await stop?.();
});

describe('tenant roles in People', () => {
  it('carries over what the old first-person rule granted, and nothing more', async () => {
    const rows = await admin`SELECT account_id, role FROM people.role_grant
                              WHERE tenant_id = ${LEGACY} ORDER BY role`;
    expect(rows).toEqual([
      { account_id: id(109), role: 'hr' },
      { account_id: id(109), role: 'people_admin' },
    ]);
  });

  it('makes the named administrator people_admin and hr, with an event each', async () => {
    const held = await inTenant(ACME, ({ tx }) => roles.of(tx, ACME, PRIYA.account));
    expect(held.roles).toEqual(['hr', 'people_admin']);
    const events = await admin<{ payload: unknown }[]>`
      SELECT envelope -> 'payload' AS payload FROM people.outbox
       WHERE event_name = 'people.role.granted' ORDER BY created_at, event_id`;
    const reason: unknown = expect.any(String);
    expect(events.map((e) => e.payload)).toEqual([
      { accountId: PRIYA.account, role: 'people_admin', by: null, via: 'back_office', reason },
      { accountId: PRIYA.account, role: 'hr', by: null, via: 'back_office', reason },
    ]);
  });

  it('lets an administrator grant, once, with an audited event naming who, whom and why', async () => {
    const first = await grant(PRIYA.account, MARCO.account, 'finance');
    expect(first.ok && first.value.roles).toEqual(['finance']);
    expect((await grant(PRIYA.account, MARCO.account, 'finance')).ok).toBe(true);
    const events = await admin`
      SELECT envelope -> 'payload' AS payload, envelope -> 'actor' AS actor FROM people.outbox
       WHERE event_name = 'people.role.granted' AND envelope -> 'payload' ->> 'role' = 'finance'`;
    expect(events).toEqual([
      {
        payload: {
          accountId: MARCO.account,
          role: 'finance',
          by: PRIYA.account,
          via: 'people',
          reason: 'Needed',
        },
        actor: { kind: 'user', userId: PRIYA.account },
      },
    ]);
  });

  it('refuses a grant by somebody who is not an administrator, or to oneself', async () => {
    const byMarco = await grant(MARCO.account, ADAM.account, 'hr');
    expect(byMarco.ok ? null : byMarco.error.code).toBe('FORBIDDEN');
    const self = await grant(PRIYA.account, PRIYA.account, 'finance');
    expect(self.ok ? null : self.error.code).toBe('SELF_GRANT');
  });

  it('grants only to somebody who signs in here and has not left', async () => {
    const left = await grant(PRIYA.account, LEFT.account, 'hr');
    expect(left.ok ? null : left.error.code).toBe('NOT_FOUND');
  });

  it('never revokes the last people_admin, and two concurrent revocations cannot both win', async () => {
    const last = await revoke(PRIYA.account, PRIYA.account, 'people_admin');
    expect(last.ok ? null : last.error.code).toBe('LAST_ADMIN');

    expect((await grant(PRIYA.account, MARCO.account, 'people_admin')).ok).toBe(true);
    // Each tries to remove the other at once: one of them must remain.
    const outcomes = await Promise.all([
      revoke(PRIYA.account, MARCO.account, 'people_admin'),
      revoke(MARCO.account, PRIYA.account, 'people_admin'),
    ]);
    expect(outcomes.filter((o) => o.ok)).toHaveLength(1);
    const left = await admin`SELECT count(*)::int AS n FROM people.role_grant
                              WHERE tenant_id = ${ACME} AND role = 'people_admin'`;
    expect(left).toEqual([{ n: 1 }]);
  });

  it('is refused by the database too, for a path that skips the application', async () => {
    // The one administrator left, whoever won above.
    const refused = await inTenant(ACME, ({ tx }) =>
      tx.execute(sql`DELETE FROM people.role_grant WHERE role = 'people_admin'`),
    ).catch((error: unknown) => error);
    expect(String((refused as { cause?: unknown }).cause)).toMatch(/last people_admin/);
  });

  it('shows who holds what to HR and administrators only', async () => {
    // Priya holds hr whoever won above.
    const listed = await inTenant(ACME, ({ tx }) => roles.list(tx, as(PRIYA.account)));
    expect(listed.ok && listed.value.holders.map((h) => h.accountId)).toEqual([
      PRIYA.account,
      MARCO.account,
    ]);
    expect(listed.ok && listed.value.candidates.map((c) => c.accountId)).not.toContain(
      LEFT.account,
    );
    const adam = await inTenant(ACME, ({ tx }) => roles.list(tx, as(ADAM.account)));
    expect(adam.ok ? null : adam.error.code).toBe('FORBIDDEN');
  });
});
