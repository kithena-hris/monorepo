import { readdir, readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { startPostgres } from '@kithena/testing';

import { snapshotIfDue } from './snapshot.js';
import { tenantTransaction } from './unit-of-work.js';

/**
 * Everybody People holds, written as snapshots for the modules, against a real
 * Postgres as People's own role. Production's first run refused every company
 * with more than one person: every row drew the same event id.
 */

const ACME = '00000000-0000-4000-8000-00000000000a';
const SALES = '00000000-0000-4000-8000-0000000000d1';
const DESIGN = '00000000-0000-4000-8000-0000000000d2';

let stopPg: (() => Promise<void>) | undefined;
let adminClient: ReturnType<typeof postgres> | undefined;
let serviceClient: ReturnType<typeof postgres> | undefined;
let admin: PostgresJsDatabase;

const migrations = new URL('../../../../migrations/', import.meta.url);

beforeAll(async () => {
  const pg = await startPostgres();
  stopPg = pg.stop;
  adminClient = postgres(pg.url, { max: 1 });
  admin = drizzle(adminClient);
  const files = (await readdir(migrations))
    .filter((f) => f === '20260821120000_tenant_registry.sql' || /^\d{14}_people_/.test(f))
    .toSorted();
  for (const file of files) {
    await admin.execute(sql.raw(await readFile(new URL(file, migrations), 'utf8')));
  }
  await admin.execute(sql`ALTER ROLE svc_people LOGIN PASSWORD 'svc_people'`);
  const asService = new URL(pg.url);
  asService.username = 'svc_people';
  asService.password = 'svc_people';
  serviceClient = postgres(asService.toString(), { max: 1 });

  await admin.execute(sql`
    INSERT INTO people.org_unit (tenant_id, id, name)
    VALUES (${ACME}::uuid, ${SALES}::uuid, 'Sales'), (${ACME}::uuid, ${DESIGN}::uuid, 'Design')`);
  await admin.execute(sql`
    INSERT INTO people.person (tenant_id, status, given_name, family_name, work_email, org_unit_id)
    VALUES (${ACME}::uuid, 'active', 'Ada', 'Lovelace', 'ada@acme.test', ${SALES}::uuid),
           (${ACME}::uuid, 'on_leave', 'Grace', 'Hopper', 'grace@acme.test', ${DESIGN}::uuid),
           (${ACME}::uuid, 'active', 'Alan', 'Turing', NULL, NULL)`);
  await admin.execute(sql`DELETE FROM people.snapshot_due`);
  await admin.execute(sql`
    INSERT INTO people.snapshot_due (tenant_id, due_at) VALUES (${ACME}::uuid, now())`);
});

afterAll(async () => {
  await serviceClient?.end();
  await adminClient?.end();
  await stopPg?.();
});

describe('the snapshot', () => {
  it('writes every department and every nameable person, each its own event, once', async () => {
    const inTenant = tenantTransaction(drizzle(serviceClient as ReturnType<typeof postgres>));
    expect(await inTenant(ACME, (scope) => snapshotIfDue(scope.tx, ACME))).toBe(true);
    // Due no longer: the next pass writes nothing.
    expect(await inTenant(ACME, (scope) => snapshotIfDue(scope.tx, ACME))).toBe(false);

    const written = [
      ...(await admin.execute(sql`
        SELECT event_id::text AS id, event_name AS name, topic, envelope -> 'payload' AS payload
          FROM people.outbox WHERE tenant_id = ${ACME}::uuid
           AND event_name IN ('people.person.snapshot', 'people.org_unit.updated')`)),
    ] as { id: string; name: string; topic: string; payload: Record<string, unknown> }[];
    expect(new Set(written.map((w) => w.id)).size).toBe(written.length);
    expect(written.filter((w) => w.name === 'people.org_unit.updated')).toHaveLength(2);
    const people = written.filter((w) => w.name === 'people.person.snapshot');
    // Alan has no work address, so no module can show him yet.
    expect(people.map((w) => w.payload['workEmail']).toSorted()).toEqual([
      'ada@acme.test',
      'grace@acme.test',
    ]);
    expect(people.every((w) => w.topic === 'kithena.people.v1')).toBe(true);
  });
});
