import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { Redis } from 'ioredis';
import postgres from 'postgres';
import { startPostgres, startValkey } from '@kithena/testing';

import { readKey } from '../application/read-cache.js';
import { readOnly, sharing, tenantTransaction } from './unit-of-work.js';
import { valkeyReadCache } from './valkey-read-cache.js';

/**
 * The read cache's invalidation against what production runs: a unit of work
 * moves the tenant's generation on exactly when it committed a write, and an
 * answer kept in Valkey is not answered again after it.
 */

const TENANT = '00000000-0000-4000-8000-00000000ac00';
let pg: Awaited<ReturnType<typeof startPostgres>>;
let valkey: Awaited<ReturnType<typeof startValkey>>;
let client: postgres.Sql;
let redis: Redis;

beforeAll(async () => {
  [pg, valkey] = await Promise.all([startPostgres(), startValkey()]);
  client = postgres(pg.url, { max: 2, onnotice: () => {} });
  await client`CREATE TABLE note (body text)`;
  redis = new Redis(valkey.url);
});

afterAll(async () => {
  redis.disconnect();
  await client.end();
  await Promise.all([pg.stop(), valkey.stop()]);
});

describe('tenantTransaction, with the read cache', () => {
  const units = () => {
    const told: string[] = [];
    const inTenant = tenantTransaction(drizzle(client), (tenantId) => {
      told.push(tenantId);
      return Promise.resolve();
    });
    return { told, inTenant };
  };

  it('says a unit of work changed the tenant once it has committed a write', async () => {
    const { told, inTenant } = units();
    await inTenant(TENANT, ({ tx }) => tx.execute(sql`INSERT INTO note VALUES ('kept')`));
    expect(told).toEqual([TENANT]);
  });

  it('says nothing of a unit that only read, or read only', async () => {
    const { told, inTenant } = units();
    await inTenant(TENANT, ({ tx }) => tx.execute(sql`SELECT count(*) FROM note`));
    await readOnly(() => inTenant(TENANT, ({ tx }) => tx.execute(sql`SELECT 1`)));
    expect(told).toEqual([]);
  });

  it('says nothing of a write that rolled back', async () => {
    const { told, inTenant } = units();
    await expect(
      inTenant(TENANT, async ({ tx }) => {
        await tx.execute(sql`INSERT INTO note VALUES ('gone')`);
        throw new Error('refused');
      }),
    ).rejects.toThrow('refused');
    expect(told).toEqual([]);
  });

  it('says once for a unit that wrote inside another, when the outer commits', async () => {
    const { told, inTenant } = units();
    await inTenant(TENANT, async ({ tx }) => {
      await sharing({ tx, tenantId: TENANT }, () =>
        inTenant(TENANT, ({ tx: inner }) => inner.execute(sql`INSERT INTO note VALUES ('nested')`)),
      );
    });
    expect(told).toEqual([TENANT]);
  });
});

describe('valkeyReadCache, in Valkey', () => {
  it('answers what it kept until a committed write moves the tenant on', async () => {
    const cache = valkeyReadCache(redis);
    const inTenant = tenantTransaction(drizzle(client), cache.changed);
    const key = readKey({ accountId: 'a-1', roles: new Set(['hr']) }, '/v1/views/overview');

    const miss = await cache.read(TENANT, key);
    expect(miss).toEqual({ hit: false, generation: '0' });
    if (miss.hit || miss.generation === null) throw new Error('expected a miss');
    await cache.write(TENANT, key, miss.generation, { headcount: 3 });
    expect(await cache.read(TENANT, key)).toEqual({ hit: true, value: { headcount: 3 } });
    // Nothing kept outlives a minute, nor the generation a day.
    expect(await redis.ttl(`people:read:gen:${TENANT}`)).toBe(-2);

    await inTenant(TENANT, ({ tx }) => tx.execute(sql`SELECT 1`));
    expect((await cache.read(TENANT, key)).hit).toBe(true);
    await inTenant(TENANT, ({ tx }) => tx.execute(sql`INSERT INTO note VALUES ('changed')`));
    expect(await cache.read(TENANT, key)).toEqual({ hit: false, generation: '1' });
    expect(await redis.ttl(`people:read:gen:${TENANT}`)).toBeGreaterThan(60);
  });
});
