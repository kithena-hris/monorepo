import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres, { type Sql } from 'postgres';
import { startPostgres } from '@kithena/testing';

import type { Entry } from '../domain/entry.js';
import type { Filter } from '../domain/reading.js';
import { drizzleEntryStore, purgeBefore, type InTenant } from './drizzle-entry-store.js';

/**
 * The log against a real Postgres, as `svc_audit`: whether one company can
 * read another's (the policy's answer, not the code's), whether a redelivered
 * event is one entry (the constraint's), whether the service can change or
 * remove a line (the grants'), and what each filter narrows to.
 */

const ACME = '00000000-0000-4000-8000-00000000000a';
const GLOBEX = '00000000-0000-4000-8000-00000000000b';
const ADA = '00000000-0000-4000-8000-0000000000a1';
const SUPPORT = '00000000-0000-4000-8000-0000000000a9';
const OPERATOR = '00000000-0000-4000-8000-0000000000f1';

let stop: (() => Promise<void>) | undefined;
let adminClient: Sql | undefined;
let serviceClient: Sql | undefined;
let db: PostgresJsDatabase;
let admin: PostgresJsDatabase;

beforeAll(async () => {
  const pg = await startPostgres();
  stop = pg.stop;
  adminClient = postgres(pg.url, { max: 1 });
  admin = drizzle(adminClient);
  await admin.execute(sql`CREATE ROLE svc_audit LOGIN PASSWORD 'svc_audit' NOBYPASSRLS`);
  const path = new URL('../../../../migrations/20260929160000_audit.sql', import.meta.url);
  await admin.execute(sql.raw(await readFile(path, 'utf8')));
  const asService = new URL(pg.url);
  asService.username = 'svc_audit';
  asService.password = 'svc_audit';
  serviceClient = postgres(asService.toString(), { max: 4 });
  db = drizzle(serviceClient);
}, 180_000);

afterAll(async () => {
  await adminClient?.end();
  await serviceClient?.end();
  await stop?.();
});

const inTenant: InTenant = (tenantId, fn) =>
  db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx);
  });

let n = 0;
function entry(over: Partial<Entry> = {}): Entry {
  n += 1;
  return {
    tenantId: ACME,
    sourceEventId: `01890000-0000-7000-8000-${String(n).padStart(12, '0')}`,
    occurredAt: '2026-09-29T10:00:00.000Z',
    recordedAt: '2026-09-29T10:00:01.000Z',
    module: 'people',
    area: 'fields',
    action: 'Added a field',
    detail: null,
    actor: { kind: 'person', accountId: ADA, onBehalfOf: null },
    subject: { kind: 'setting', id: null, label: 'Work phone' },
    reason: null,
    ...over,
  };
}

const ALL: Filter = {
  areas: [],
  actorKind: null,
  actor: null,
  subject: null,
  from: null,
  until: null,
  search: null,
};

describe('the log in Postgres', () => {
  it('holds a redelivered event once', async () => {
    const store = drizzleEntryStore(inTenant);
    const once = entry();
    expect(await store.append(once)).toBe(true);
    expect(await store.append(once)).toBe(false);
  });

  it('never shows one company another’s entries', async () => {
    const store = drizzleEntryStore(inTenant);
    await store.append(entry({ tenantId: GLOBEX, action: 'Globex only' }));
    const acme = await store.page(ACME, { filter: ALL, before: null, limit: 100 });
    expect(acme.some((e) => e.action === 'Globex only')).toBe(false);
    // Nor, asking for Globex's rows by id from inside Acme's scope.
    const leaked = await inTenant(ACME, (tx) =>
      tx.execute(sql`SELECT 1 FROM audit.entry WHERE tenant_id = ${GLOBEX}::uuid`),
    );
    expect([...leaked]).toHaveLength(0);
  });

  it('cannot be changed or removed by the service', async () => {
    const store = drizzleEntryStore(inTenant);
    await store.append(entry());
    await expect(
      inTenant(ACME, (tx) => tx.execute(sql`UPDATE audit.entry SET action = 'Nothing happened'`)),
    ).rejects.toThrow();
    await expect(inTenant(ACME, (tx) => tx.execute(sql`DELETE FROM audit.entry`))).rejects.toThrow();
  });

  it('narrows by area, who, whose record, when and words, newest first', async () => {
    const store = drizzleEntryStore(inTenant);
    const tenant = '00000000-0000-4000-8000-00000000000c';
    const at = (day: number) => `2026-09-${String(day).padStart(2, '0')}T12:00:00.000Z`;
    await store.append(entry({ tenantId: tenant, occurredAt: at(1), area: 'roles', action: 'Granted a role' }));
    await store.append(
      entry({
        tenantId: tenant,
        occurredAt: at(2),
        area: 'imports_exports',
        action: 'Exported people',
        reason: 'Year-end 50% review',
        subject: { kind: 'export', id: 'x1', label: null },
      }),
    );
    await store.append(
      entry({
        tenantId: tenant,
        occurredAt: at(3),
        area: 'sensitive_access',
        action: 'Read an identifier in full',
        actor: { kind: 'system', accountId: null, onBehalfOf: null },
        subject: { kind: 'person', id: ADA, label: null },
      }),
    );
    const page = (filter: Partial<Filter>) =>
      store.page(tenant, { filter: { ...ALL, ...filter }, before: null, limit: 10 });
    const actions = async (filter: Partial<Filter>) => (await page(filter)).map((e) => e.action);

    expect(await actions({})).toEqual([
      'Read an identifier in full',
      'Exported people',
      'Granted a role',
    ]);
    expect(await actions({ areas: ['roles', 'imports_exports'] })).toEqual([
      'Exported people',
      'Granted a role',
    ]);
    expect(await actions({ actorKind: 'system' })).toEqual(['Read an identifier in full']);
    expect(await actions({ actor: ADA })).toEqual(['Exported people', 'Granted a role']);
    expect(await actions({ subject: ADA })).toEqual(['Read an identifier in full']);
    expect(await actions({ from: at(2), until: at(3) })).toEqual(['Exported people']);
    // LIKE's own characters are literal: "50%" is not "50 anything".
    expect(await actions({ search: '50%' })).toEqual(['Exported people']);
    expect(await actions({ search: '5_%' })).toEqual([]);

    const [newest] = await page({});
    expect(
      (await store.page(tenant, { filter: ALL, before: newest?.id ?? null, limit: 10 })).map(
        (e) => e.action,
      ),
    ).toEqual(['Exported people', 'Granted a role']);
  });

  it('links what support did to the sign-in it did it in, and so to the reason', async () => {
    const store = drizzleEntryStore(inTenant);
    const tenant = '00000000-0000-4000-8000-00000000000d';
    const support = { kind: 'support' as const, accountId: SUPPORT, onBehalfOf: OPERATOR };
    await store.append(
      entry({
        tenantId: tenant,
        module: 'identity',
        area: 'sign_in',
        action: 'Kithena support signed in',
        occurredAt: '2026-09-29T09:00:00.000Z',
        actor: support,
        reason: 'Earlier ticket',
      }),
    );
    await store.append(
      entry({
        tenantId: tenant,
        module: 'identity',
        area: 'sign_in',
        action: 'Kithena support signed in',
        occurredAt: '2026-09-29T10:00:00.000Z',
        actor: support,
        reason: 'Ticket 4411',
      }),
    );
    await store.append(
      entry({ tenantId: tenant, occurredAt: '2026-09-29T10:20:00.000Z', actor: support }),
    );
    // Two hours on: no sign-in covers it any more.
    await store.append(
      entry({
        tenantId: tenant,
        occurredAt: '2026-09-29T12:30:00.000Z',
        actor: support,
        action: 'Stale',
      }),
    );
    const rows = await store.page(tenant, { filter: ALL, before: null, limit: 10 });
    expect(rows.find((e) => e.action === 'Added a field')?.supportSignIn?.reason).toBe(
      'Ticket 4411',
    );
    expect(rows.find((e) => e.action === 'Stale')?.supportSignIn).toBeNull();
    expect(rows.find((e) => e.reason === 'Ticket 4411')?.supportSignIn).toBeNull();
  });

  it('refuses support that does not say which operator', async () => {
    const store = drizzleEntryStore(inTenant);
    await expect(
      store.append(entry({ actor: { kind: 'support', accountId: SUPPORT, onBehalfOf: null } })),
    ).rejects.toThrow();
  });

  it('lets retention remove old entries, through its one function, for every company', async () => {
    const store = drizzleEntryStore(inTenant);
    const tenant = '00000000-0000-4000-8000-00000000000e';
    await store.append(entry({ tenantId: tenant, occurredAt: '2020-01-01T00:00:00.000Z', action: 'Old' }));
    await store.append(entry({ tenantId: tenant, occurredAt: '2026-09-29T00:00:00.000Z', action: 'New' }));
    expect(await purgeBefore(db, '2021-01-01T00:00:00.000Z')).toBeGreaterThanOrEqual(1);
    const left = await store.page(tenant, { filter: ALL, before: null, limit: 10 });
    expect(left.map((e) => e.action)).toEqual(['New']);
  });
});
