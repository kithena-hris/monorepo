import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { fixedClock } from '@kithena/domain-kit';
import type { FieldPolicy } from '@kithena/contracts';
import { startPostgres } from '@kithena/testing';

import { drizzleRetentionStore } from '../../infrastructure/drizzle-retention-store.js';
import {
  drizzlePeopleFacts,
  drizzleSchemaRepository,
} from '../../infrastructure/drizzle-schema-repository.js';
import { tenantTransaction } from '../../infrastructure/unit-of-work.js';
import { publishSchema } from '../schema/publish-schema.js';
import { anonymiseDue } from './anonymise.js';

/**
 * PEO-037 against a real database: a leaver four and a half years gone, a
 * statutory floor that has passed, one that has not, and a tenant policy that
 * has. What is cleared, what survives, and what the event says.
 */

const ACME = '00000000-0000-4000-8000-00000000000a';
const ADA = '00000000-0000-4000-8000-0000000000a1';
const clock = fixedClock('2026-09-22T09:00:00.000Z');

let stopPg: (() => Promise<void>) | undefined;
let adminClient: ReturnType<typeof postgres> | undefined;
let serviceClient: ReturnType<typeof postgres> | undefined;
let admin: PostgresJsDatabase;
let inTenant: ReturnType<typeof tenantTransaction>;

let ids = 0;
const newEventId = () => `01890000-0000-7000-8000-${String((ids += 1)).padStart(12, '0')}`;
const anonymise = anonymiseDue({ store: drizzleRetentionStore(), clock, newEventId });
const run = () =>
  inTenant(ACME, ({ tx }) =>
    anonymise(tx, {
      tenantId: ACME,
      personId: ADA,
      actor: { kind: 'system', process: 'retention' },
      correlationId: '00000000-0000-4000-8000-0000000000c1',
    }),
  );

const migration = (file: string): Promise<string> =>
  readFile(new URL(`../../../../../migrations/${file}`, import.meta.url), 'utf8');

const kept = (retention?: FieldPolicy['retention']): FieldPolicy => ({
  classification: 'confidential',
  piiKind: 'identity',
  exportable: true,
  aiEligible: false,
  ...(retention ? { retention } : {}),
});

async function define(key: string, policy: FieldPolicy, origin = 'tenant'): Promise<void> {
  await admin.execute(sql`
    INSERT INTO people.attribute_definition (
      tenant_id, key, section_key, labels, ord, data_type, type_config, cardinality,
      requiredness, ownership, visibility, collect_at, classification, classification_source,
      include_in_events, origin
    ) VALUES (
      ${ACME}::uuid, ${key}, 'profile', ${JSON.stringify({ default: key })}::jsonb, 0,
      'text', ${JSON.stringify({ kind: 'text' })}::jsonb, 'single',
      ${JSON.stringify({ mode: 'never' })}::jsonb, ${'{"hr"}'}::text[], ${'{"hr"}'}::text[], 'hr_only',
      ${JSON.stringify(policy)}::jsonb, 'human', false, ${origin}
    )
  `);
}

beforeAll(async () => {
  const pg = await startPostgres();
  stopPg = pg.stop;
  adminClient = postgres(pg.url, { max: 1 });
  admin = drizzle(adminClient);
  for (const file of [
    '20260821120000_tenant_registry.sql',
    '20260922140000_people_bootstrap.sql',
    '20260922160000_people_registry.sql',
    '20260922170000_people_person.sql',
    '20260923110000_people_completeness.sql',
  ]) {
    await admin.execute(sql.raw(await migration(file)));
  }
  await admin.execute(sql`ALTER ROLE svc_people LOGIN PASSWORD 'svc_people'`);
  const asService = new URL(pg.url);
  asService.username = 'svc_people';
  asService.password = 'svc_people';
  serviceClient = postgres(asService.toString(), { max: 4 });
  inTenant = tenantTransaction(drizzle(serviceClient));

  await admin.execute(sql`
    INSERT INTO people.section (tenant_id, key, labels, ord, visibility, origin)
    VALUES (${ACME}::uuid, 'profile', ${JSON.stringify({ default: 'Profile' })}::jsonb, 0,
            ${'{"hr"}'}::text[], 'tenant')
  `);
  await define('given_name', kept({ monthsAfterTermination: 24 }), 'core');
  await define('phone', kept({ monthsAfterTermination: 6 }));
  await define('payslip_ref', kept({ monthsAfterTermination: 12, statutoryFloor: 'es-labour' }));
  await define('pension_ref', kept({ monthsAfterTermination: 12, statutoryFloor: 'de-labour' }));
  await define('hobby', kept());

  const published = await inTenant(ACME, ({ tx }) =>
    publishSchema({ schema: drizzleSchemaRepository(), people: drizzlePeopleFacts(), clock, newEventId }).publish(tx, {
      tenantId: ACME,
      actor: { kind: 'system', process: 'integration-test' },
      publishedBy: null,
      correlationId: '00000000-0000-4000-8000-0000000000c1',
      artifactUrl: 'https://api.kithena.test/v1/people/schema/1',
    }),
  );
  expect(published.ok).toBe(true);
  await admin.execute(sql`DELETE FROM people.outbox`);

  // Left on 31 March 2022: four and a half years before the clock.
  await admin.execute(sql`
    INSERT INTO people.person (id, tenant_id, status, given_name, family_name, last_working_day, custom, schema_version)
    VALUES (${ADA}::uuid, ${ACME}::uuid, 'terminated', 'Ada', 'Lovelace', '2022-03-31',
            ${JSON.stringify({ phone: '+34 600 000 000', payslip_ref: 'P-1', pension_ref: 'DE-9', hobby: 'chess' })}::jsonb, 1)
  `);
});

afterAll(async () => {
  await serviceClient?.end();
  await adminClient?.end();
  await stopPg?.();
});

describe('anonymising a leaver', () => {
  it('clears what is due and keeps what a statutory floor still holds', async () => {
    const result = await run();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect([...result.value.cleared].toSorted()).toEqual(['given_name', 'payslip_ref', 'phone']);

    const rows = await admin.execute(sql`SELECT given_name, family_name, custom FROM people.person`);
    const row = [...rows][0];
    expect(row?.['given_name']).toBeNull();
    // No retention policy on family_name: never cleared by this job.
    expect(row?.['family_name']).toBe('Lovelace');
    // pension_ref: the tenant said 12 months, German law says six years.
    expect(row?.['custom']).toEqual({ pension_ref: 'DE-9', hobby: 'chess' });
  });

  it('says which classes were cleared, and under which rule', async () => {
    const rows = await admin.execute(sql`
      SELECT envelope FROM people.outbox WHERE event_name = 'people.person.anonymised'
    `);
    const payloads = [...rows]
      .map((r) => (r['envelope'] as { payload: { under: string; attributeKeys: string[]; classesCleared: string[] } }).payload)
      .map((p) => ({ ...p, attributeKeys: p.attributeKeys.toSorted() }))
      .toSorted((a, b) => a.under.localeCompare(b.under));

    expect(payloads).toEqual([
      { personId: ADA, under: 'statutory_floor', attributeKeys: ['payslip_ref'], classesCleared: ['confidential'] },
      { personId: ADA, under: 'tenant_policy', attributeKeys: ['given_name', 'phone'], classesCleared: ['confidential'] },
    ]);
  });

  it('does nothing the second time', async () => {
    const again = await run();
    expect(again).toEqual({ ok: true, value: { cleared: [] } });
    const rows = await admin.execute(sql`SELECT count(*)::int AS n FROM people.outbox`);
    expect(Number([...rows][0]?.['n'])).toBe(2);
  });
});
