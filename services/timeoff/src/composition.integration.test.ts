import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readdir, readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { CalendarDate } from '@kithena/contracts';
import { startOpenFga, startPostgres } from '@kithena/testing';

import { member, people, TENANT } from './application/testing/world.js';
import { composeTimeOff } from './composition.js';
import { timeoffFgaFrom } from './infrastructure/openfga.js';

/**
 * TOF-050a: the composition root `main.ts` boots, whole, against real
 * Postgres (as `svc_timeoff`) and a real OpenFGA. A member saved through it
 * gets their tuples; a request carrying only the router's principal — an
 * account, no person — is answered as that member, over REST and GraphQL.
 */

const MIGRATIONS_DIR = new URL('../../../migrations/', import.meta.url);
const TOKEN = 'router-to-timeoff';
const ADAM_ACCOUNT = people.adam.replace(/^00000000/u, '0000000a');

let stopPg: (() => Promise<void>) | undefined;
let stopFga: (() => Promise<void>) | undefined;
let admin: ReturnType<typeof postgres> | undefined;
let server: Server | undefined;
let base = '';
let fgaUrl = '';

const asAdam = {
  'x-internal-token': TOKEN,
  'x-kithena-principal': JSON.stringify({
    userId: ADAM_ACCOUNT,
    tenantId: TENANT,
    entitlements: ['module.timeoff'],
  }),
};

beforeAll(async () => {
  const [pg, fga] = await Promise.all([startPostgres(), startOpenFga()]);
  stopPg = pg.stop;
  stopFga = fga.stop;
  fgaUrl = fga.apiUrl;
  admin = postgres(pg.url, { max: 1, onnotice: () => {} });
  const db = drizzle(admin);
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.includes('_timeoff_')).toSorted();
  for (const file of files) {
    // oxlint-disable-next-line no-await-in-loop -- in order, each builds on the last
    await db.execute(sql.raw(await readFile(new URL(file, MIGRATIONS_DIR), 'utf8')));
  }
  await db.execute(sql`ALTER ROLE svc_timeoff LOGIN PASSWORD 'svc_timeoff'`);
  const asService = new URL(pg.url);
  asService.username = 'svc_timeoff';
  asService.password = 'svc_timeoff';

  const composed = await composeTimeOff({
    TIMEOFF_DATABASE_URL: asService.toString(),
    OPENFGA_URL: fga.apiUrl,
    TIMEOFF_API_TOKEN: TOKEN,
    TIMEOFF_FEED_SECRET: 'integration-feed-secret',
  });
  if (composed.storage === null) throw new Error('composed without storage');
  // Through the composed unit of work, as the consumers and the import write.
  await composed.storage.uow.run(TENANT, async (tx) => {
    await tx.members.save(member(people.marco, 'Marco Rossi'));
    await tx.members.save(member(people.adam, 'Adam Novak'));
  });

  server = createServer(composed.listener);
  await new Promise<void>((resolve) => server?.listen(0, resolve));
  base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
}, 240_000);

afterAll(async () => {
  server?.closeAllConnections();
  await new Promise((resolve) => server?.close(resolve));
  await admin?.end();
  await stopFga?.();
  await stopPg?.();
});

describe('the composition root', () => {
  it('says it is up', async () => {
    const response = await fetch(`${base}/healthz`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it('answers REST as the member the account signs in as', async () => {
    const response = await fetch(`${base}/v1/timeoff/overview`, { headers: asAdam });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { member: { personId: string } | null };
    expect(body.member?.personId).toBe(people.adam);
  });

  it('answers GraphQL from the same storage', async () => {
    const response = await fetch(`${base}/graphql`, {
      method: 'POST',
      headers: { ...asAdam, 'content-type': 'application/json' },
      body: JSON.stringify({
        query: '{ timeOffOverview { member { personId displayName managerPersonId } } }',
      }),
    });
    expect(await response.json()).toEqual({
      data: {
        timeOffOverview: {
          member: {
            personId: people.adam,
            displayName: 'Adam Novak',
            managerPersonId: people.marco,
          },
        },
      },
    });
  });

  it('refuses a request the router did not send', async () => {
    const response = await fetch(`${base}/v1/timeoff/overview`, {
      headers: { ...asAdam, 'x-internal-token': 'guessed' },
    });
    expect(response.status).toBe(401);
  });

  it('wrote the saved members’ tuples to Time Off’s store', async () => {
    const fga = timeoffFgaFrom({ OPENFGA_URL: fgaUrl }, () => CalendarDate.parse('2026-10-01'));
    const check = (user: `person:${string}`, relation: 'approver' | 'teammate') =>
      fga?.authorizer.check(TENANT, { user, relation, object: `member:${people.adam}` });
    expect(await check(`person:${people.marco}`, 'approver')).toBe(true);
    expect(await check(`person:${people.marco}`, 'teammate')).toBe(true);
    expect(await check(`person:${people.adam}`, 'approver')).toBe(false);
  });
});
