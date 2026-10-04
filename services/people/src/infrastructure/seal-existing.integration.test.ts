import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { startPostgres } from '@kithena/testing';

import { staticKeyRing } from './envelope.js';
import { sealExisting } from './seal-existing.js';
import { drizzleSecretStore } from './secret-store.js';
import { tenantTransaction } from './unit-of-work.js';

/**
 * Encrypting a field that already holds values (publishing the version that
 * does it): every value sealed, no plain copy left on the record, and the
 * field's history redacted rather than kept in the clear.
 */

const ACME = '00000000-0000-4000-8000-00000000000a';
const ADA = '00000000-0000-4000-8000-0000000000a1';
const BOB = '00000000-0000-4000-8000-0000000000b2';
const HISTORY = '00000000-0000-4000-8000-0000000000c3';

let stopPg: (() => Promise<void>) | undefined;
let adminClient: ReturnType<typeof postgres> | undefined;
let serviceClient: ReturnType<typeof postgres> | undefined;
let admin: PostgresJsDatabase;
let inTenant: ReturnType<typeof tenantTransaction>;
const store = drizzleSecretStore(staticKeyRing([{ id: 'k1', key: randomBytes(32) }]));

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
    '20260926230000_people_pending_change_decided_as.sql',
    '20260922170000_people_person.sql',
    '20260923140000_people_retention.sql',
    '20260924220000_people_access_end.sql',
    '20260926143000_people_duplicates.sql',
    '20260924220200_people_employment_period.sql',
    '20260924170000_people_calendar.sql',
    '20261005090000_people_org_unit.sql',
    '20260924170100_people_tenant_company.sql',
    '20260927210000_people_history_sealed.sql',
  ]) {
    await admin.execute(sql.raw(await migration(file)));
  }
  await admin.execute(sql`ALTER ROLE svc_people LOGIN PASSWORD 'svc_people'`);
  const asService = new URL(pg.url);
  asService.username = 'svc_people';
  asService.password = 'svc_people';
  serviceClient = postgres(asService.toString(), { max: 2 });
  inTenant = tenantTransaction(drizzle(serviceClient));

  await admin.execute(sql`
    INSERT INTO people.person (id, tenant_id, status, custom) VALUES
      (${ADA}::uuid, ${ACME}::uuid, 'active', '{"passport": "X1234567", "shirt": "M"}'::jsonb),
      (${BOB}::uuid, ${ACME}::uuid, 'active', '{"shirt": "L"}'::jsonb)`);
  await admin.execute(sql`
    INSERT INTO people.person_attribute_history
      (id, tenant_id, person_id, attribute_key, value, effective_from, actor)
    VALUES (${HISTORY}::uuid, ${ACME}::uuid, ${ADA}::uuid, 'passport', '"X0000001"'::jsonb, '2021-01-01',
            ${JSON.stringify({ kind: 'system', process: 'seed' })}::jsonb)`);
});

afterAll(async () => {
  await serviceClient?.end();
  await adminClient?.end();
  await stopPg?.();
});

describe('sealing a field that already holds values', () => {
  it('seals each value, drops the plain copy, and redacts the history', async () => {
    await inTenant(ACME, ({ tx }) => sealExisting(store)(tx, ACME, ['passport']));

    const people = await admin.execute<{ id: string; custom: Record<string, unknown> }>(sql`
      SELECT id, custom FROM people.person ORDER BY id`);
    expect([...people].map((p) => p.custom)).toEqual([{ shirt: 'M' }, { shirt: 'L' }]);

    const sealed = await inTenant(ACME, ({ tx }) => store.list(tx, ACME, ADA));
    expect(sealed.map((s) => [s.attributeKey, s.last4])).toEqual([['passport', '4567']]);
    expect(await inTenant(ACME, ({ tx }) => store.reveal(tx, { tenantId: ACME, personId: ADA, attributeKey: 'passport' }))).toBe(
      'X1234567',
    );

    const [history] = await admin.execute<{ value: unknown; reason: string | null }>(sql`
      SELECT value, redaction_reason AS reason FROM people.person_attribute_history WHERE id = ${HISTORY}::uuid`);
    expect(history).toEqual({ value: null, reason: 'encrypted' });

    // Nowhere in the schema in the clear any more.
    const dump = await admin.execute<{ t: string }>(sql`
      SELECT string_agg(row_to_json(p)::text, ' ') AS t FROM people.person p`);
    expect(JSON.stringify([...dump])).not.toContain('X1234567');
  });
});
