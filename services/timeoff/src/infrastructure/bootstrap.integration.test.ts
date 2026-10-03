import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { readFile } from 'node:fs/promises';
import { publish } from '@kithena/db-kit';
import type { PendingEvent } from '@kithena/domain-kit';
import { CalendarDate, Instant, TenantId } from '@kithena/contracts';
import { startPostgres } from '@kithena/testing';

import { outbox } from './tables.js';

/**
 * The schema bootstrap and the outbox (TOF-001, TOF-002), against the real
 * migrations and nothing else — applying only Time Off's files is what says
 * they are self-sufficient on a database nobody prepared.
 *
 * The outbox is the probe: it is the first tenant-scoped table in the schema,
 * so it is where `svc_timeoff` with no `app.tenant_id` either sees nothing or
 * reads every company's events.
 */

const TENANT_A = '00000000-0000-4000-8000-00000000000a';
const TENANT_B = '00000000-0000-4000-8000-00000000000b';
const MIGRATIONS = ['20261003100000_timeoff_bootstrap.sql', '20261003100100_timeoff_outbox.sql'];

let stopPg: (() => Promise<void>) | undefined;
let adminClient: ReturnType<typeof postgres> | undefined;
let serviceClient: ReturnType<typeof postgres> | undefined;
let admin: PostgresJsDatabase;
let asTimeoff: PostgresJsDatabase;

const migration = async (file: string): Promise<string> =>
  readFile(new URL(`../../../../migrations/${file}`, import.meta.url), 'utf8');

beforeAll(async () => {
  const pg = await startPostgres();
  stopPg = pg.stop;
  adminClient = postgres(pg.url, { max: 1 });
  admin = drizzle(adminClient);

  // In order, one after the other: the outbox needs the schema.
  // oxlint-disable-next-line no-await-in-loop
  for (const file of MIGRATIONS) await admin.execute(sql.raw(await migration(file)));

  // NOLOGIN in the migration, because a password in a committed file is a
  // credential in the repository; the operator grants it out of band.
  await admin.execute(sql`ALTER ROLE svc_timeoff LOGIN PASSWORD 'svc_timeoff'`);

  const asService = new URL(pg.url);
  asService.username = 'svc_timeoff';
  asService.password = 'svc_timeoff';
  serviceClient = postgres(asService.toString(), { max: 4 });
  asTimeoff = drizzle(serviceClient);
});

afterAll(async () => {
  await serviceClient?.end();
  await adminClient?.end();
  await stopPg?.();
});

function inTenant<T>(tenantId: string, fn: (tx: PostgresJsDatabase) => Promise<T>): Promise<T> {
  return asTimeoff.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx);
  });
}

/** A pending event as an aggregate raises one; the outbox does not read the payload. */
function event(tenantId: string, eventId: string): PendingEvent {
  return {
    eventId,
    eventName: 'timeoff.request.requested',
    eventVersion: 2,
    tenantId: TenantId.parse(tenantId),
    occurredAt: Instant.parse('2026-10-03T09:00:00.000Z'),
    effectiveFrom: CalendarDate.parse('2026-10-13'),
    aggregate: { type: 'LeaveRequest', id: 'request-1', version: 1 },
    actor: { kind: 'system', process: 'integration-test' },
    correlationId: '00000000-0000-4000-8000-000000000002',
    causationId: null,
    payload: {},
  };
}

const tenantsVisible = async (tx: PostgresJsDatabase): Promise<string[]> =>
  [...(await tx.execute(sql`SELECT tenant_id::text AS t FROM timeoff.outbox ORDER BY 1`))].map(
    (row) => String(row['t']),
  );

describe('the timeoff schema bootstrap', () => {
  it('applies twice without complaint', async () => {
    // A retried deploy re-runs it; there are no down migrations.
    await expect(
      admin.execute(sql.raw(await migration(MIGRATIONS[0] ?? ''))),
    ).resolves.toBeDefined();
  });

  it('creates svc_timeoff without the attribute that would defeat every policy', async () => {
    const rows = await admin.execute(
      sql`SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = 'svc_timeoff'`,
    );
    expect([...rows][0]).toMatchObject({ rolbypassrls: false, rolsuper: false });
  });
});

describe('the outbox', () => {
  it('takes an event through publish() and gives it back, with the topic the relay routes by', async () => {
    await inTenant(TENANT_A, (tx) =>
      publish(tx, outbox, [event(TENANT_A, '01890000-0000-7000-8000-0000000000a1')]),
    );
    await inTenant(TENANT_B, (tx) =>
      publish(tx, outbox, [event(TENANT_B, '01890000-0000-7000-8000-0000000000b1')]),
    );

    const rows = await inTenant(TENANT_A, (tx) =>
      tx.select({ name: outbox.eventName, key: outbox.partitionKey }).from(outbox),
    );
    expect(rows).toEqual([{ name: 'timeoff.request.requested', key: `${TENANT_A}:request-1` }]);

    const topic = await admin.execute(sql`SELECT DISTINCT topic FROM timeoff.outbox`);
    expect([...topic]).toEqual([{ topic: 'kithena.timeoff.v2' }]);
  });

  it('shows a connection with no tenant set nothing at all', async () => {
    expect(await tenantsVisible(asTimeoff)).toEqual([]);
  });

  it('shows a tenant its own events only', async () => {
    expect(await inTenant(TENANT_B, tenantsVisible)).toEqual([TENANT_B]);
  });

  it('refuses an event written for another tenant', async () => {
    await expect(
      inTenant(TENANT_A, (tx) =>
        publish(tx, outbox, [event(TENANT_B, '01890000-0000-7000-8000-0000000000a2')]),
      ),
    ).rejects.toThrow();
  });

  it('is in the relay publication', async () => {
    const rows = await admin.execute(sql`
      SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'kithena_outbox' AND schemaname = 'timeoff' AND tablename = 'outbox'`);
    expect([...rows]).toHaveLength(1);
  });
});
