import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { readFile } from 'node:fs/promises';
import { startPostgres } from '@kithena/testing';

import { sharing, tenantTransaction } from '../infrastructure/unit-of-work.js';
import { drizzleIdempotency } from './idempotency.js';

/** The key table over Postgres, as `svc_people`: first writer wins, and tenants do not share keys. */

const ACME = '00000000-0000-4000-8000-00000000000a';
const GLOBEX = '00000000-0000-4000-8000-00000000000b';
const RESOURCE = '00000000-0000-4000-8000-0000000000a1';

let stopPg: (() => Promise<void>) | undefined;
const clients: ReturnType<typeof postgres>[] = [];
let inTenant: ReturnType<typeof tenantTransaction>;
const store = drizzleIdempotency();

const migration = (file: string): Promise<string> =>
  readFile(new URL(`../../../../migrations/${file}`, import.meta.url), 'utf8');

beforeAll(async () => {
  const pg = await startPostgres();
  stopPg = pg.stop;
  const adminClient = postgres(pg.url, { max: 1 });
  clients.push(adminClient);
  const admin = drizzle(adminClient);
  for (const file of [
    '20260821120000_tenant_registry.sql',
    '20260922140000_people_bootstrap.sql',
    '20260922160000_people_registry.sql',
    '20260926140000_people_visibility_rules.sql',
    '20260926160000_people_pending_change.sql',
    '20260922170000_people_person.sql',
    '20260924220000_people_access_end.sql',
    '20260924220200_people_employment_period.sql',
    '20260923110000_people_completeness.sql',
    '20260923120000_people_webhooks.sql',
    '20260924170000_people_calendar.sql',
    '20260924170100_people_tenant_company.sql',
  ]) {
    await admin.execute(sql.raw(await migration(file)));
  }
  await admin.execute(sql`ALTER ROLE svc_people LOGIN PASSWORD 'svc_people'`);
  const asService = new URL(pg.url);
  asService.username = 'svc_people';
  asService.password = 'svc_people';
  const serviceClient = postgres(asService.toString(), { max: 2 });
  clients.push(serviceClient);
  inTenant = tenantTransaction(drizzle(serviceClient));
});

afterAll(async () => {
  for (const c of clients) await c.end();
  await stopPg?.();
});

const stored = { requestHash: 'a'.repeat(64), status: 200, resourceId: RESOURCE };

describe('idempotency keys over Postgres', () => {
  it('keeps the first writer and reports the second', async () => {
    expect(await inTenant(ACME, ({ tx }) => store.save(tx, ACME, 'k1', stored))).toBe(true);
    expect(
      await inTenant(ACME, ({ tx }) => store.save(tx, ACME, 'k1', { ...stored, status: 201 })),
    ).toBe(false);
    expect(await inTenant(ACME, ({ tx }) => store.find(tx, ACME, 'k1'))).toEqual(stored);
  });

  it('does not show one tenant another tenant’s key', async () => {
    expect(await inTenant(GLOBEX, ({ tx }) => store.find(tx, ACME, 'k1'))).toBeNull();
    expect(await inTenant(GLOBEX, ({ tx }) => store.save(tx, GLOBEX, 'k1', stored))).toBe(true);
  });
});

describe('a keyed write whose use case opens its own transactions (PEO-116)', () => {
  it('commits the key and the write together, or neither', async () => {
    await expect(
      inTenant(ACME, ({ tx }) =>
        sharing({ tx, tenantId: ACME }, async () => {
          await store.save(tx, ACME, 'outer-1', stored);
          // The use case's own unit of work: joins, rather than committing alone.
          await inTenant(ACME, ({ tx: inner }) => store.save(inner, ACME, 'inner-1', stored));
          throw new Error('the key could not be kept');
        }),
      ),
    ).rejects.toThrow('the key could not be kept');
    expect(await inTenant(ACME, ({ tx }) => store.find(tx, ACME, 'outer-1'))).toBeNull();
    expect(await inTenant(ACME, ({ tx }) => store.find(tx, ACME, 'inner-1'))).toBeNull();
  });

  it('rolls back a refused inner unit alone, as a savepoint', async () => {
    await inTenant(ACME, ({ tx }) =>
      sharing({ tx, tenantId: ACME }, async () => {
        await store.save(tx, ACME, 'outer-2', stored);
        await inTenant(ACME, async ({ tx: inner }) => {
          await store.save(inner, ACME, 'inner-2', stored);
          throw new Error('refused');
        }).catch(() => undefined);
      }),
    );
    expect(await inTenant(ACME, ({ tx }) => store.find(tx, ACME, 'outer-2'))).toEqual(stored);
    expect(await inTenant(ACME, ({ tx }) => store.find(tx, ACME, 'inner-2'))).toBeNull();
  });

  it('never joins another tenant’s transaction', async () => {
    await expect(
      inTenant(ACME, ({ tx }) =>
        sharing({ tx, tenantId: ACME }, async () => {
          await inTenant(GLOBEX, ({ tx: own }) => store.save(own, GLOBEX, 'own-3', stored));
          throw new Error('outer refused');
        }),
      ),
    ).rejects.toThrow('outer refused');
    expect(await inTenant(GLOBEX, ({ tx }) => store.find(tx, GLOBEX, 'own-3'))).toEqual(stored);
  });
});
