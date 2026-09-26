import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { fixedClock } from '@kithena/domain-kit';
import type { FieldPolicy } from '@kithena/contracts';
import { startPostgres } from '@kithena/testing';

import type { ViewerRelations } from '../../domain/access/field-access.js';
import { drizzleDsarSource } from '../../infrastructure/drizzle-dsar-source.js';
import { drizzlePersonRepository } from '../../infrastructure/drizzle-person-repository.js';
import {
  drizzlePeopleFacts,
  drizzleSchemaRepository,
} from '../../infrastructure/drizzle-schema-repository.js';
import { staticKeyRing } from '../../infrastructure/envelope.js';
import { drizzleSecretStore } from '../../infrastructure/secret-store.js';
import { tenantTransaction } from '../../infrastructure/unit-of-work.js';
import { publishSchema } from '../schema/publish-schema.js';
import { exportDsar } from './export-dsar.js';
import { utcCalendars } from '../org/org.js';

/**
 * PEO-036: every exportable attribute, tenant-defined ones included, in the
 * pack — under the version the record was written under, in under a minute.
 */

const ACME = '00000000-0000-4000-8000-00000000000a';
const ADA = '00000000-0000-4000-8000-0000000000a1';
const IBAN = 'ES9121000418450200051332';
const clock = fixedClock('2026-09-22T09:00:00.000Z');

const subject: ViewerRelations = {
  isSelf: true,
  isManager: false,
  isInManagerChain: false,
  isHr: false,
  isFinance: false,
  isAdmin: false,
};

let stopPg: (() => Promise<void>) | undefined;
let adminClient: ReturnType<typeof postgres> | undefined;
let serviceClient: ReturnType<typeof postgres> | undefined;
let admin: PostgresJsDatabase;
let inTenant: ReturnType<typeof tenantTransaction>;

const secrets = drizzleSecretStore(staticKeyRing([{ id: 'k1', key: randomBytes(32) }]));
const dsar = exportDsar({
  source: drizzleDsarSource(),
  people: drizzlePersonRepository(),
  secrets,
  clock,
});

let ids = 0;
const publisher = publishSchema({ calendars: utcCalendars,
  schema: drizzleSchemaRepository(),
  people: drizzlePeopleFacts(),
  clock,
  newEventId: () => `01890000-0000-7000-8000-${String((ids += 1)).padStart(12, '0')}`,
});
const publish = () =>
  inTenant(ACME, ({ tx }) =>
    publisher.publish(tx, {
      tenantId: ACME,
      actor: { kind: 'system', process: 'integration-test' },
      publishedBy: null,
      correlationId: '00000000-0000-4000-8000-0000000000c1',
      artifactUrl: 'https://api.kithena.test/v1/people/schema',
    }),
  );

const migration = (file: string): Promise<string> =>
  readFile(new URL(`../../../../../migrations/${file}`, import.meta.url), 'utf8');

const policy = (over: Partial<FieldPolicy>): FieldPolicy => ({
  classification: 'internal',
  piiKind: 'none',
  exportable: true,
  aiEligible: false,
  ...over,
});

async function define(
  key: string,
  classification: FieldPolicy,
  over: { origin?: string; encrypted?: boolean; visibility?: string } = {},
): Promise<void> {
  await admin.execute(sql`
    INSERT INTO people.attribute_definition (
      tenant_id, key, section_key, labels, ord, data_type, type_config, cardinality,
      requiredness, ownership, visibility, collect_at, classification, classification_source,
      include_in_events, encrypted, origin
    ) VALUES (
      ${ACME}::uuid, ${key}, 'profile', ${JSON.stringify({ default: key })}::jsonb, 0,
      'text', ${JSON.stringify({ kind: 'text' })}::jsonb, 'single',
      ${JSON.stringify({ mode: 'never' })}::jsonb, ${'{"employee"}'}::text[],
      ${over.visibility ?? '{"self"}'}::text[], 'anytime',
      ${JSON.stringify(classification)}::jsonb, 'human', false, ${over.encrypted ?? false},
      ${over.origin ?? 'tenant'}
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
    '20260926140000_people_visibility_rules.sql',
    '20260922170000_people_person.sql',
    '20260924220000_people_access_end.sql',
    '20260926143000_people_duplicates.sql',
    '20260924220200_people_employment_period.sql',
    '20260923110000_people_completeness.sql',
    '20260923140000_people_retention.sql',
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

  await admin.execute(sql`
    INSERT INTO people.section (tenant_id, key, labels, ord, visibility, origin)
    VALUES (${ACME}::uuid, 'profile', ${JSON.stringify({ default: 'Profile' })}::jsonb, 0,
            ${'{"self"}'}::text[], 'tenant')
  `);

  // Version 1: a core field, three tenant-defined ones and one that is not exportable.
  await define('given_name', policy({ classification: 'confidential', piiKind: 'identity' }), { origin: 'core' });
  await define('religion', policy({ classification: 'special-category' }), { visibility: '{}' });
  await define('bank_account', policy({ classification: 'confidential', piiKind: 'financial' }), { encrypted: true });
  await define('shoe_size', policy({}));
  await define('hr_judgement', policy({ exportable: false }));
  expect((await publish()).ok).toBe(true);

  // Version 2 adds a field this record was never written under.
  await define('added_later', policy({}));
  expect((await publish()).ok).toBe(true);

  await admin.execute(sql`
    INSERT INTO people.person (id, tenant_id, status, given_name, custom, schema_version)
    VALUES (${ADA}::uuid, ${ACME}::uuid, 'active', 'Ada',
            ${JSON.stringify({ religion: 'Pastafarian', shoe_size: 38, hr_judgement: 'difficult' })}::jsonb, 1)
  `);
  await inTenant(ACME, ({ tx }) =>
    secrets.put(tx, { tenantId: ACME, personId: ADA, attributeKey: 'bank_account' }, IBAN),
  );
  for (const [id, key, value] of [
    ['01890000-0000-7000-8000-0000000000f1', 'shoe_size', 37],
    ['01890000-0000-7000-8000-0000000000f2', 'hr_judgement', 'difficult'],
  ] as const) {
    // eslint-disable-next-line no-await-in-loop -- two rows, in a test
    await admin.execute(sql`
      INSERT INTO people.person_attribute_history (id, tenant_id, person_id, attribute_key, value, effective_from, actor)
      VALUES (${id}::uuid, ${ACME}::uuid, ${ADA}::uuid, ${key}, ${JSON.stringify(value)}::jsonb, '2026-01-01',
              ${JSON.stringify({ kind: 'system', process: 'seed' })}::jsonb)
    `);
  }
  await admin.execute(sql`
    INSERT INTO people.outbox (event_id, tenant_id, event_name, event_version, aggregate_type, aggregate_id, partition_key, envelope)
    VALUES ('01890000-0000-7000-8000-0000000000e1'::uuid, ${ACME}::uuid, 'people.person.hired', '1', 'Person',
            ${ADA}, ${`${ACME}:${ADA}`}, ${JSON.stringify({ eventName: 'people.person.hired' })}::jsonb)
  `);
});

afterAll(async () => {
  await serviceClient?.end();
  await adminClient?.end();
  await stopPg?.();
});

describe('a subject access export', () => {
  it('contains every exportable attribute of the version the record was written under, in under a minute', async () => {
    const started = performance.now();
    const result = await inTenant(ACME, ({ tx }) => dsar(tx, { tenantId: ACME, personId: ADA, requester: subject }));
    const elapsed = performance.now() - started;

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const v1 = await admin.execute(sql`SELECT document FROM people.schema_version WHERE version = 1`);
    const document = [...v1][0]?.['document'] as
      | { attributes: { key: string; classification: FieldPolicy }[] }
      | undefined;
    const attributes = document?.attributes ?? [];
    const exportable = attributes.filter((a) => a.classification.exportable).map((a) => a.key).toSorted();

    expect(result.value.schemaVersion).toBe(1);
    expect(result.value.attributes.map((a) => a.key).toSorted()).toEqual(exportable);
    expect(exportable).toEqual(['bank_account', 'given_name', 'religion', 'shoe_size']);
    expect(elapsed).toBeLessThan(60_000);
  });

  it('carries the values, special-category and encrypted included', async () => {
    const result = await inTenant(ACME, ({ tx }) => dsar(tx, { tenantId: ACME, personId: ADA, requester: subject }));
    if (!result.ok) throw new Error(result.error.message);

    const values = Object.fromEntries(result.value.attributes.map((a) => [a.key, a.value]));
    expect(values).toEqual({ given_name: 'Ada', religion: 'Pastafarian', bank_account: IBAN, shoe_size: 38 });
  });

  it('includes history and events, and withholds what the policy does not export', async () => {
    const result = await inTenant(ACME, ({ tx }) => dsar(tx, { tenantId: ACME, personId: ADA, requester: subject }));
    if (!result.ok) throw new Error(result.error.message);

    expect(result.value.history.map((h) => h.attributeKey)).toEqual(['shoe_size']);
    expect(result.value.events).toEqual([{ eventName: 'people.person.hired' }]);
    expect(JSON.stringify(result.value)).not.toContain('difficult');
  });

  it('is refused to anybody but the subject', async () => {
    const result = await inTenant(ACME, ({ tx }) =>
      dsar(tx, { tenantId: ACME, personId: ADA, requester: { ...subject, isSelf: false, isHr: true } }),
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'DSAR_NOT_SUBJECT' } });
  });

  // Last, because it redacts a row the tests above read.
  it('still exports once retention has redacted part of the history', async () => {
    await admin.execute(sql`
      UPDATE people.person_attribute_history
         SET value = NULL, redacted_at = now(), redaction_reason = 'retention'
       WHERE attribute_key = 'shoe_size'
    `);

    const result = await inTenant(ACME, ({ tx }) => dsar(tx, { tenantId: ACME, personId: ADA, requester: subject }));
    if (!result.ok) throw new Error(result.error.message);

    // The fact of the change survives; what it was does not.
    expect(result.value.history).toMatchObject([
      { attributeKey: 'shoe_size', value: null, effectiveFrom: '2026-01-01' },
    ]);
    expect(result.value.attributes.map((a) => a.key).toSorted()).toEqual([
      'bank_account',
      'given_name',
      'religion',
      'shoe_size',
    ]);
  });
});
