import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { fixedClock } from '@kithena/domain-kit';
import { startPostgres } from '@kithena/testing';

import {
  drizzleProvisionalPeople,
  httpAccountDirectory,
} from '../infrastructure/consumers/identity.js';
import { tenantTransaction } from '../infrastructure/unit-of-work.js';
import { reconcile, type AccountDirectory, type IdentityAccount } from './reconcile.js';

/**
 * PEO-028: a tenant that buys People after running on identity alone.
 *
 * The acceptance is that a second run changes nothing, which is asserted as
 * literally as it can be: every person row and every outbox row, before and
 * after.
 */

const ACME = '00000000-0000-4000-8000-00000000000a';
const TOKEN = 'internal-test-token';
const clock = fixedClock('2026-09-23T09:00:00.000Z');
const ctx = {
  actor: { kind: 'system', process: 'reconcile' } as const,
  correlationId: '00000000-0000-4000-8000-0000000000c1',
  causationId: null,
};

let ids = 0;
const newEventId = () => {
  ids += 1;
  return `01890000-0000-7000-8000-${String(ids).padStart(12, '0')}`;
};

const accounts: IdentityAccount[] = [1, 2, 3].map((i) => ({
  accountId: `00000000-0000-4000-8000-0000000000a${String(i)}`,
  workEmail: `p${String(i)}@acme.test`,
  timeZone: 'Europe/Madrid',
  employmentStart: '2025-01-0' + String(i),
  // One enrolled before People existed, so identity has a name for them.
  name: i === 1 ? { given: 'Ada', family: 'Lovelace', preferred: null } : null,
}));

let stopPg: (() => Promise<void>) | undefined;
let adminClient: ReturnType<typeof postgres> | undefined;
let serviceClient: ReturnType<typeof postgres> | undefined;
let admin: PostgresJsDatabase;
let inTenant: ReturnType<typeof tenantTransaction>;
let identity: Server;
let identityUrl: string;

const migration = (file: string): Promise<string> =>
  readFile(new URL(`../../../../migrations/${file}`, import.meta.url), 'utf8');

beforeAll(async () => {
  const pg = await startPostgres();
  stopPg = pg.stop;
  adminClient = postgres(pg.url, { max: 1 });
  admin = drizzle(adminClient);
  for (const file of [
    '20260821120000_tenant_registry.sql',
    '20260922140000_people_bootstrap.sql',
    '20260922160000_people_registry.sql',
    '20260926140000_people_visibility_rules.sql',
    '20260926180000_people_pending_change.sql',
    '20260922170000_people_person.sql',
    '20260924220000_people_access_end.sql',
    '20260924220200_people_employment_period.sql',
    '20260923110000_people_completeness.sql',
    '20260924170000_people_calendar.sql',
    '20260924170100_people_tenant_company.sql',
  ]) {
    await admin.execute(sql.raw(await migration(file)));
  }
  await admin.execute(sql`ALTER ROLE svc_people LOGIN PASSWORD 'svc_people'`);
  const asService = new URL(pg.url);
  asService.username = 'svc_people';
  asService.password = 'svc_people';
  serviceClient = postgres(asService.toString(), { max: 4 });
  inTenant = tenantTransaction(drizzle(serviceClient));

  // Identity's endpoint, served in two pages of the shape the adapter expects.
  identity = createServer((request, response) => {
    if (request.headers['x-internal-token'] !== TOKEN) {
      response.writeHead(401).end();
      return;
    }
    const url = new URL(request.url ?? '/', 'http://identity');
    if (url.pathname !== `/api/internal/tenants/${ACME}/accounts`) {
      response.writeHead(404).end();
      return;
    }
    const second = url.searchParams.get('cursor') === 'page-2';
    response
      .writeHead(200, { 'content-type': 'application/json' })
      .end(
        JSON.stringify(
          second
            ? { accounts: accounts.slice(2), nextCursor: null }
            : { accounts: accounts.slice(0, 2), nextCursor: 'page-2' },
        ),
      );
  });
  await new Promise<void>((resolve) => identity.listen(0, '127.0.0.1', resolve));
  identityUrl = `http://127.0.0.1:${String((identity.address() as AddressInfo).port)}`;
});

afterAll(async () => {
  // Missing when `beforeAll` failed, which is then the only error worth reading.
  const server = identity as Server | undefined;
  if (server) await new Promise((resolve) => server.close(resolve));
  await serviceClient?.end();
  await adminClient?.end();
  await stopPg?.();
});

beforeEach(async () => {
  await admin.execute(sql`DELETE FROM people.outbox`);
  await admin.execute(sql`DELETE FROM people.person`);
});

const run = (directory: AccountDirectory) =>
  reconcile({
    directory,
    people: drizzleProvisionalPeople({ clock, newEventId }),
    inTenant,
  })(ACME, ctx);

async function snapshot() {
  const people = await admin.execute(sql`SELECT * FROM people.person ORDER BY identity_account_id`);
  const events = await admin.execute(
    sql`SELECT event_id, envelope FROM people.outbox ORDER BY event_id`,
  );
  return { people: [...people], events: [...events] };
}

describe('reconciliation', () => {
  it('creates a provisional person per account, and a second run changes nothing', async () => {
    const directory = httpAccountDirectory({ baseUrl: identityUrl, internalToken: TOKEN });

    const first = await run(directory);
    expect(first).toEqual({ ok: true, value: { seen: 3, created: 3 } });
    const after = await snapshot();
    expect(after.people).toHaveLength(3);
    expect(after.events).toHaveLength(3);
    expect(after.people[0]).toMatchObject({ status: 'provisional', given_name: 'Ada' });

    const second = await run(directory);
    expect(second).toEqual({ ok: true, value: { seen: 3, created: 0 } });
    expect(await snapshot()).toEqual(after);
  });

  it('skips the accounts the consumer already provisioned', async () => {
    await inTenant(ACME, ({ tx }) =>
      drizzleProvisionalPeople({ clock, newEventId }).provision(
        tx,
        ACME,
        accounts[0] as IdentityAccount,
        ctx,
      ),
    );

    const result = await run(httpAccountDirectory({ baseUrl: identityUrl, internalToken: TOKEN }));
    expect(result).toEqual({ ok: true, value: { seen: 3, created: 2 } });
  });

  it('reports identity refusing the request as a failure rather than throwing', async () => {
    const result = await run(
      httpAccountDirectory({ baseUrl: identityUrl, internalToken: 'wrong' }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('DIRECTORY_UNAVAILABLE');
  });
});
