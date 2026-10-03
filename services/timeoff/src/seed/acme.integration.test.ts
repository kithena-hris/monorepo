import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { readdir, readFile } from 'node:fs/promises';
import { CalendarDate, LeaveTypeKey } from '@kithena/contracts';
import { startPostgres } from '@kithena/testing';

import type { UnitOfWork } from '../application/ports.js';
import { balanceFor } from '../application/shared.js';
import { TENANT } from '../application/testing/world.js';
import { drizzleUnitOfWork, uuidv7 } from '../infrastructure/unit-of-work.js';
import { seedAcme, team } from './acme.js';

/** The seed against the real tables, as `svc_timeoff`: what `pnpm db:seed` runs. */

const MIGRATIONS_DIR = new URL('../../../../migrations/', import.meta.url);
let stop: (() => Promise<void>) | undefined;
let clients: ReturnType<typeof postgres>[] = [];
let uow: UnitOfWork;

beforeAll(async () => {
  const pg = await startPostgres();
  stop = pg.stop;
  const adminClient = postgres(pg.url, { max: 1, onnotice: () => {} });
  const admin = drizzle(adminClient);
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.includes('_timeoff_')).toSorted();
  for (const file of files) {
    // oxlint-disable-next-line no-await-in-loop -- in order, each builds on the last
    await admin.execute(sql.raw(await readFile(new URL(file, MIGRATIONS_DIR), 'utf8')));
  }
  await admin.execute(sql`ALTER ROLE svc_timeoff LOGIN PASSWORD 'svc_timeoff'`);
  const asService = new URL(pg.url);
  asService.username = 'svc_timeoff';
  asService.password = 'svc_timeoff';
  const service = postgres(asService.toString(), { max: 2 });
  clients = [adminClient, service];
  uow = drizzleUnitOfWork(drizzle(service));
});

afterAll(async () => {
  await Promise.all(clients.map((c) => c.end()));
  await stop?.();
});

describe('the Acme seed, in Postgres', () => {
  it('writes the team with Adam on 11.5 days, and a second run writes nothing', async () => {
    const first = await seedAcme(uow, TENANT, uuidv7);
    expect(first).toEqual({ ok: true, value: { members: 7, requests: 11 } });

    const vacation = await uow.run(TENANT, async (tx) => {
      const adam = await tx.members.get(team.adam);
      if (adam === null) throw new Error('no Adam');
      return balanceFor(tx, adam, LeaveTypeKey.parse('vacation'), CalendarDate.parse('2026-10-01'));
    });
    expect(vacation).toMatchObject({ left: '11.500', used: '10.500', booked: '3.000' });
    expect(await uow.run(TENANT, (tx) => tx.requests.list({}))).toHaveLength(11);

    expect(await seedAcme(uow, TENANT, uuidv7)).toEqual({ ok: true, value: null });
  });
});
