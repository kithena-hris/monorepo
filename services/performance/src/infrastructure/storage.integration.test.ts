import { readdir, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TenantId } from '@kithena/contracts';
import { startPostgres } from '@kithena/testing';

import { oneCycle } from '../testing/scenario.js';
import { drizzleUnitOfWork } from './unit-of-work.js';

/**
 * Performance's storage (PRF-036), against every Performance migration and
 * nothing else, as `svc_performance`: the scenario the standalone suite runs
 * in memory, over Postgres, and one company seeing nothing of another's.
 */

const MIGRATIONS = new URL('../../../../migrations/', import.meta.url);
let stopPg: (() => Promise<void>) | undefined;
const clients: ReturnType<typeof postgres>[] = [];
let admin: ReturnType<typeof postgres>;
let service: ReturnType<typeof postgres>;

beforeAll(async () => {
  const pg = await startPostgres();
  stopPg = pg.stop;
  admin = postgres(pg.url, { max: 1, onnotice: () => {} });
  clients.push(admin);
  const files = (await readdir(MIGRATIONS)).filter((f) => f.includes('_performance_')).toSorted();
  for (const f of files) {
    // oxlint-disable-next-line no-await-in-loop -- in order, each builds on the last
    await admin.unsafe(await readFile(new URL(f, MIGRATIONS), 'utf8'));
  }
  await admin.unsafe(`ALTER ROLE svc_performance LOGIN PASSWORD 'svc_performance'`);
  const url = new URL(pg.url);
  url.username = 'svc_performance';
  url.password = 'svc_performance';
  service = postgres(url.toString(), { max: 4 });
  clients.push(service);
}, 180_000);

afterAll(async () => {
  for (const c of clients) await c.end({ timeout: 5 });
  await stopPg?.();
});

describe('Performance over Postgres', () => {
  it('runs one cycle end to end', async () => {
    const uow = drizzleUnitOfWork(drizzle(service));
    await oneCycle({
      uow,
      events: async (tenantId) =>
        (
          await admin`SELECT envelope FROM performance.outbox WHERE tenant_id = ${tenantId} ORDER BY created_at`
        ).map((r) => r['envelope'] as { eventName: string; payload: unknown }),
    });
  });

  it('keeps one company’s records from another', async () => {
    const uow = drizzleUnitOfWork(drizzle(service));
    const a = randomUUID() as TenantId;
    const b = randomUUID() as TenantId;
    await uow.run(a, (tx) => tx.settings.set('roles', { hr: [] }));
    await uow.run(a, (tx) =>
      tx.orgUnits.save({ id: randomUUID(), name: 'Engineering', parentId: null }),
    );
    expect(await uow.run(b, (tx) => tx.orgUnits.find())).toEqual([]);
    expect(await uow.run(b, (tx) => tx.settings.get('roles'))).toBeNull();
  });

  it('refuses a stale autosave and a second review with the same key', async () => {
    const uow = drizzleUnitOfWork(drizzle(service));
    const t = randomUUID() as TenantId;
    const review = {
      id: randomUUID(),
      cycleId: randomUUID(),
      kind: 'self',
      subjectId: randomUUID(),
      authorId: randomUUID(),
      status: 'not_started',
      revision: 0,
    };
    await uow.run(t, (tx) => tx.reviews.save(review as never));
    expect(await uow.run(t, (tx) => tx.reviews.save({ ...review, revision: 1 } as never, 0))).toBe(
      true,
    );
    expect(await uow.run(t, (tx) => tx.reviews.save({ ...review, revision: 2 } as never, 0))).toBe(
      false,
    );
    await expect(
      uow.run(t, (tx) => tx.reviews.save({ ...review, id: randomUUID() } as never)),
    ).rejects.toThrow();
  });
});
