import { readdir, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TenantId } from '@kithena/contracts';
import { startPostgres } from '@kithena/testing';

import { defaultTemplate } from '../domain/country.js';
import { welcomeAndReview } from '../testing/scenario.js';
import { drizzleUnitOfWork } from './unit-of-work.js';

/**
 * Onboarding's storage (ONB-006), against every Onboarding migration and
 * nothing else, as `svc_onboarding`: the scenario the standalone suite runs in
 * memory, over Postgres, and one company seeing nothing of another's.
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
  const files = (await readdir(MIGRATIONS)).filter((f) => f.includes('_onboarding_')).toSorted();
  for (const f of files) {
    // oxlint-disable-next-line no-await-in-loop -- in order, each builds on the last
    await admin.unsafe(await readFile(new URL(f, MIGRATIONS), 'utf8'));
  }
  await admin.unsafe(`ALTER ROLE svc_onboarding LOGIN PASSWORD 'svc_onboarding'`);
  const url = new URL(pg.url);
  url.username = 'svc_onboarding';
  url.password = 'svc_onboarding';
  service = postgres(url.toString(), { max: 4 });
  clients.push(service);
}, 180_000);

afterAll(async () => {
  for (const c of clients) await c.end({ timeout: 5 });
  await stopPg?.();
});

describe('Onboarding over Postgres', () => {
  it('welcomes a hire and records the probation review', async () => {
    const uow = drizzleUnitOfWork(drizzle(service));
    await welcomeAndReview({
      uow,
      events: async (tenantId) =>
        (
          await admin`SELECT envelope FROM onboarding.outbox WHERE tenant_id = ${tenantId} ORDER BY created_at, event_id`
        ).map((r) => {
          const e = r['envelope'] as { eventName: string; payload: unknown };
          return { eventName: e.eventName, payload: e.payload };
        }),
    });
  });

  it('shows one company nothing of another’s', async () => {
    const uow = drizzleUnitOfWork(drizzle(service));
    const mine = randomUUID() as TenantId;
    const theirs = randomUUID() as TenantId;
    await uow.run(mine, (tx) => tx.templates.save(defaultTemplate(randomUUID())));
    expect(await uow.run(theirs, (tx) => tx.templates.list())).toEqual([]);
    expect((await uow.run(mine, (tx) => tx.templates.list())).map((t) => t.name)).toEqual([
      'Everyone',
    ]);
    expect(await service`SELECT * FROM onboarding.template`).toHaveLength(0);
  });
});
