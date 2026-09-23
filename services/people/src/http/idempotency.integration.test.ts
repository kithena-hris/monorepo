import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { readFile } from 'node:fs/promises';
import { startPostgres } from '@kithena/testing';

import { tenantTransaction } from '../infrastructure/unit-of-work.js';
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
    '20260922170000_people_person.sql',
    '20260923110000_people_completeness.sql',
    '20260923120000_people_webhooks.sql',
    '20260924170000_people_calendar.sql',
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
