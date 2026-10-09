import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres, { type Sql } from 'postgres';
import { startPostgres } from '@kithena/testing';

import { drizzleDigestStore } from './infrastructure/drizzle-digest-store.js';

/**
 * The Inbox's daily digest store, against a real Postgres (INB-050): updates
 * held per company under row-level security, which companies have any asked
 * across them all through the one SECURITY DEFINER function, and a digest
 * taken once, by person, with nothing left to send twice.
 */

const ACME = '00000000-0000-4000-8000-00000000000a';
const GLOBEX = '00000000-0000-4000-8000-00000000000b';

let stop: (() => Promise<void>) | undefined;
let adminClient: Sql | undefined;
let serviceClient: Sql | undefined;
let db: PostgresJsDatabase;

beforeAll(async () => {
  const pg = await startPostgres();
  stop = pg.stop;
  adminClient = postgres(pg.url, { max: 1 });
  const admin = drizzle(adminClient);
  await admin.execute(sql`CREATE ROLE svc_messaging LOGIN PASSWORD 'svc_messaging' NOBYPASSRLS`);
  for (const file of [
    '20260821120000_tenant_registry.sql',
    '20260824090000_messaging.sql',
    '20261010140000_messaging_inbox.sql',
  ]) {
    const path = new URL(`../../../../migrations/${file}`, import.meta.url);
    await admin.execute(sql.raw(await readFile(path, 'utf8')));
  }
  const asService = new URL(pg.url);
  asService.username = 'svc_messaging';
  asService.password = 'svc_messaging';
  serviceClient = postgres(asService.toString(), { max: 2 });
  db = drizzle(serviceClient);
}, 180_000);

afterAll(async () => {
  await adminClient?.end();
  await serviceClient?.end();
  await stop?.();
});

const store = () =>
  drizzleDigestStore(db, (tenantId, fn) =>
    db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
      return fn(tx);
    }),
  );

describe('the daily digest', () => {
  it('holds updates per company, finds which have any, and takes each once by person', async () => {
    const s = store();
    const held = (tenantId: string, email: string) => ({
      tenantId,
      email,
      companyName: tenantId === ACME ? 'Acme' : 'Globex',
      url: `https://${tenantId === ACME ? 'acme' : 'globex'}.app.kithena.com/inbox/updates`,
    });
    await s.hold(held(ACME, 'adam@acme.example'));
    await s.hold(held(ACME, 'adam@acme.example'));
    await s.hold(held(ACME, 'mei@acme.example'));
    await s.hold(held(GLOBEX, 'ana@globex.example'));

    expect([...(await s.tenantsWaiting())].sort()).toEqual([ACME, GLOBEX]);
    const acme = await s.take(ACME);
    expect(acme.map((d) => [d.email, d.count]).sort()).toEqual([
      ['adam@acme.example', 2],
      ['mei@acme.example', 1],
    ]);
    // Taken: nothing left to send twice, and Globex untouched by Acme's take.
    expect(await s.take(ACME)).toEqual([]);
    expect(await s.tenantsWaiting()).toEqual([GLOBEX]);
  });
});
