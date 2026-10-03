import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { readdir, readFile } from 'node:fs/promises';
import { startPostgres } from '@kithena/testing';

import { drizzleIdempotency } from './idempotency.js';

/** TOF-046's keys against every Time Off migration, as `svc_timeoff`. */

const ACME = '00000000-0000-4000-8000-00000000000a';
const GLOBEX = '00000000-0000-4000-8000-00000000000b';
const MIGRATIONS_DIR = new URL('../../../../migrations/', import.meta.url);

let stopPg: (() => Promise<void>) | undefined;
const clients: ReturnType<typeof postgres>[] = [];
let asTimeoff: PostgresJsDatabase;

beforeAll(async () => {
  const pg = await startPostgres();
  stopPg = pg.stop;
  const adminClient = postgres(pg.url, { max: 1, onnotice: () => {} });
  clients.push(adminClient);
  const admin = drizzle(adminClient);
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.includes('_timeoff_')).toSorted();
  for (const file of files) {
    // oxlint-disable-next-line no-await-in-loop
    await admin.execute(sql.raw(await readFile(new URL(file, MIGRATIONS_DIR), 'utf8')));
  }
  await admin.execute(sql`ALTER ROLE svc_timeoff LOGIN PASSWORD 'svc_timeoff'`);
  const asService = new URL(pg.url);
  asService.username = 'svc_timeoff';
  asService.password = 'svc_timeoff';
  const serviceClient = postgres(asService.toString(), { max: 2 });
  clients.push(serviceClient);
  asTimeoff = drizzle(serviceClient);
}, 180_000);

afterAll(async () => {
  for (const client of clients) await client.end();
  await stopPg?.();
});

const inTenant = <T>(tenant: string, fn: (tx: PostgresJsDatabase) => Promise<T>): Promise<T> =>
  asTimeoff.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenant}, true)`);
    return fn(tx);
  });

describe('idempotency keys', () => {
  const stored = {
    requestHash: 'a'.repeat(64),
    status: 201,
    answer: { requestId: 'r1', status: 'pending' },
  };

  it('keeps the answer as JSON, once per key, inside the tenant', async () => {
    expect(await inTenant(ACME, (tx) => drizzleIdempotency(tx, ACME).save('k1', stored))).toBe(
      true,
    );
    expect(await inTenant(ACME, (tx) => drizzleIdempotency(tx, ACME).find('k1'))).toEqual(stored);
    // A second request with the key is told somebody committed it first.
    expect(
      await inTenant(ACME, (tx) =>
        drizzleIdempotency(tx, ACME).save('k1', { ...stored, status: 200 }),
      ),
    ).toBe(false);
    // Another tenant neither sees it nor is blocked by it.
    expect(await inTenant(GLOBEX, (tx) => drizzleIdempotency(tx, GLOBEX).find('k1'))).toBeNull();
    expect(await inTenant(GLOBEX, (tx) => drizzleIdempotency(tx, GLOBEX).save('k1', stored))).toBe(
      true,
    );
  });

  it('is never changed or removed by the service', async () => {
    const refusal = (work: Promise<unknown>) =>
      work.then(
        () => 'resolved',
        (e: unknown) => (e as { cause?: { code?: string } }).cause?.code,
      );
    const INSUFFICIENT_PRIVILEGE = '42501';
    expect(
      await refusal(
        inTenant(ACME, (tx) => tx.execute(sql`UPDATE timeoff.idempotency_key SET status = 500`)),
      ),
    ).toBe(INSUFFICIENT_PRIVILEGE);
    expect(
      await refusal(inTenant(ACME, (tx) => tx.execute(sql`DELETE FROM timeoff.idempotency_key`))),
    ).toBe(INSUFFICIENT_PRIVILEGE);
  });
});
