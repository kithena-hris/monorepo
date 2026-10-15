import { readdir, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TenantId } from '@kithena/contracts';
import { startPostgres } from '@kithena/testing';

import { memoryBlobs } from '../testing/memory.js';
import { hireInSpain, type Harness } from '../testing/scenario.js';
import { drizzleUnitOfWork } from './unit-of-work.js';

/**
 * Recruiting's storage (REC-041), against every Recruiting migration and
 * nothing else, as `svc_recruiting`: the hire the standalone suite runs in
 * memory, over Postgres. A connection with no tenant sees nothing, and the
 * Kithena Jobs role reads the public projection and nothing else.
 */

const MIGRATIONS = new URL('../../../../migrations/', import.meta.url);
let stopPg: (() => Promise<void>) | undefined;
const clients: ReturnType<typeof postgres>[] = [];
let admin: ReturnType<typeof postgres>;
let service: ReturnType<typeof postgres>;
let reader: ReturnType<typeof postgres>;

beforeAll(async () => {
  const pg = await startPostgres();
  stopPg = pg.stop;
  admin = postgres(pg.url, { max: 1, onnotice: () => {} });
  clients.push(admin);
  const files = (await readdir(MIGRATIONS)).filter((f) => f.includes('_recruiting_')).toSorted();
  for (const f of files) {
    // oxlint-disable-next-line no-await-in-loop -- in order, each builds on the last
    await admin.unsafe(await readFile(new URL(f, MIGRATIONS), 'utf8'));
  }
  await admin.unsafe(`ALTER ROLE svc_recruiting LOGIN PASSWORD 'svc_recruiting'`);
  await admin.unsafe(`ALTER ROLE svc_jobs_reader LOGIN PASSWORD 'svc_jobs_reader'`);
  const as = (role: string) => {
    const url = new URL(pg.url);
    url.username = role;
    url.password = role;
    return url.toString();
  };
  service = postgres(as('svc_recruiting'), { max: 4 });
  reader = postgres(as('svc_jobs_reader'), { max: 2 });
  clients.push(service, reader);
}, 180_000);

afterAll(async () => {
  for (const c of clients) await c.end({ timeout: 5 });
  await stopPg?.();
});

describe('Recruiting over Postgres', () => {
  it('hires a candidate from requisition to pre-hire', async () => {
    const harness: Harness = {
      uow: drizzleUnitOfWork(drizzle(service)),
      blobs: memoryBlobs(),
      events: async (tenantId) =>
        (
          await admin`SELECT envelope FROM recruiting.outbox WHERE tenant_id = ${tenantId} ORDER BY created_at, event_id`
        ).map((r) => {
          const e = r['envelope'] as {
            eventName: string;
            payload: unknown;
            effectiveFrom: string | null;
          };
          return { eventName: e.eventName, payload: e.payload, effectiveFrom: e.effectiveFrom };
        }),
      // Read as Kithena Jobs reads it: the read-only role, across companies.
      listings: async () =>
        (
          await reader`SELECT title, searchable, company_slug, slug FROM recruiting_public.listing ORDER BY title`
        ).map((r) => ({
          title: String(r['title']),
          searchable: Boolean(r['searchable']),
          company: String(r['company_slug']),
          slug: String(r['slug']),
        })),
    };
    await hireInSpain(harness);
  });

  it('shows one company nothing of another’s', async () => {
    const uow = drizzleUnitOfWork(drizzle(service));
    const mine = randomUUID() as TenantId;
    const theirs = randomUUID() as TenantId;
    await uow.run(mine, (tx) =>
      tx.pools.save({ id: randomUUID(), name: 'Silver medallists', description: null }),
    );
    expect(await uow.run(theirs, (tx) => tx.pools.list())).toEqual([]);
    expect((await uow.run(mine, (tx) => tx.pools.list())).map((p) => p.name)).toEqual([
      'Silver medallists',
    ]);
    // No tenant set: the policy matches nothing.
    expect(await service`SELECT * FROM recruiting.pool`).toHaveLength(0);
  });

  it('lets Kithena Jobs read published listings and no candidate', async () => {
    await expect(reader`SELECT * FROM recruiting.candidate`).rejects.toThrow(/permission denied/u);
    await expect(
      reader`INSERT INTO recruiting_public.company (tenant_id, slug, name, theme_id) VALUES (${randomUUID()}, 'x', 'x', 'x')`,
    ).rejects.toThrow(/permission denied/u);
  });
});
