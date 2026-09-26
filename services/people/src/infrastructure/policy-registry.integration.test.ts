import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { fixedClock } from '@kithena/domain-kit';
import { aiGateway, createLogger, createPolicyRegistry } from '@kithena/telemetry';
import { startPostgres } from '@kithena/testing';

import { publishSchema } from '../application/schema/publish-schema.js';
import { drizzlePeopleFacts, drizzleSchemaRepository } from './drizzle-schema-repository.js';
import { onSchemaPublished, wirePolicyRegistry } from './policy-registry.js';
import { tenantTransaction } from './unit-of-work.js';
import { utcCalendars } from '../application/org/org.js';

/**
 * PEO-034 and PEO-035, end to end: a tenant creates an attribute, publishes,
 * and the same running process redacts it in a log line and refuses it at the
 * AI gateway. No restart, and no other tenant affected.
 */

const ACME = '00000000-0000-4000-8000-00000000000a';
const GLOBEX = '00000000-0000-4000-8000-00000000000b';
const RELIGION = 'Pastafarian';

let stopPg: (() => Promise<void>) | undefined;
let adminClient: ReturnType<typeof postgres> | undefined;
let serviceClient: ReturnType<typeof postgres> | undefined;
let admin: PostgresJsDatabase;
let inTenant: ReturnType<typeof tenantTransaction>;

let ids = 0;
const use = publishSchema({ calendars: utcCalendars,
  schema: drizzleSchemaRepository(),
  people: drizzlePeopleFacts(),
  clock: fixedClock('2026-09-22T09:00:00.000Z'),
  newEventId: () => `01890000-0000-7000-8000-${String((ids += 1)).padStart(12, '0')}`,
});

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
});

afterAll(async () => {
  await serviceClient?.end();
  await adminClient?.end();
  await stopPg?.();
});

beforeEach(async () => {
  await admin.execute(sql`TRUNCATE people.schema_version`);
  await admin.execute(sql`DELETE FROM people.outbox`);
  await admin.execute(sql`DELETE FROM people.attribute_definition`);
  await admin.execute(sql`DELETE FROM people.section`);
  await admin.execute(sql`
    INSERT INTO people.section (tenant_id, key, labels, ord, visibility, origin)
    VALUES (${ACME}::uuid, 'diversity', ${JSON.stringify({ default: 'Diversity' })}::jsonb, 0,
            ${'{"self"}'}::text[], 'tenant')
  `);
});

/** A tenant-defined special-category attribute, as the settings screen writes it. */
async function createReligionAttribute(): Promise<void> {
  await admin.execute(sql`
    INSERT INTO people.attribute_definition (
      tenant_id, key, section_key, labels, ord, data_type, type_config, cardinality,
      requiredness, ownership, visibility, collect_at, classification, classification_source,
      include_in_events, origin
    ) VALUES (
      ${ACME}::uuid, 'religion', 'diversity', ${JSON.stringify({ default: 'Religion' })}::jsonb, 0,
      'text', ${JSON.stringify({ kind: 'text' })}::jsonb, 'single',
      ${JSON.stringify({ mode: 'never' })}::jsonb, ${'{"employee"}'}::text[], ${'{"self"}'}::text[],
      'anytime',
      ${JSON.stringify({ classification: 'special-category', piiKind: 'none', exportable: true, aiEligible: false })}::jsonb,
      'human', false, 'tenant'
    )
  `);
}

/** Publish through the real use case, then deliver the event it wrote to the handler. */
async function publishAndDeliver(handler: ReturnType<typeof onSchemaPublished>): Promise<void> {
  const published = await inTenant(ACME, ({ tx }) =>
    use.publish(tx, {
      tenantId: ACME,
      actor: { kind: 'system', process: 'integration-test' },
      publishedBy: null,
      correlationId: '00000000-0000-4000-8000-0000000000c1',
      artifactUrl: 'https://api.kithena.test/v1/people/schema/1',
    }),
  );
  expect(published.ok).toBe(true);

  const rows = await admin.execute(sql`SELECT event_name, tenant_id FROM people.outbox`);
  for (const row of rows) {
    // eslint-disable-next-line no-await-in-loop -- one event, in a test
    await handler({ eventName: String(row['event_name']), tenantId: String(row['tenant_id']) });
  }
}

function capture() {
  const lines: string[] = [];
  return { base: createLogger({ write: (line: string) => lines.push(line) }), lines };
}

describe('a tenant attribute created at runtime', () => {
  it('is redacted in a log line after publish, without a restart', async () => {
    const registry = createPolicyRegistry({ unknownTenantRedaction: [] });
    await wirePolicyRegistry(inTenant, [ACME, GLOBEX], registry);
    const { base, lines } = capture();
    const line = { person: { custom: { religion: RELIGION } } };

    registry.loggerFor(base, ACME).info(line, 'before');
    expect(lines.at(-1)).toContain(RELIGION);

    await createReligionAttribute();
    await publishAndDeliver(onSchemaPublished(inTenant, registry));

    registry.loggerFor(base, ACME).info(line, 'after');
    expect(lines.at(-1)).not.toContain(RELIGION);

    // Another tenant's logs are not redacted by ACME's field names.
    registry.loggerFor(base, GLOBEX).info(line, 'globex');
    expect(lines.at(-1)).toContain(RELIGION);
  });

  it('stays redacted after a rollback removes it from the current version', async () => {
    const registry = createPolicyRegistry({ unknownTenantRedaction: [] });
    await createReligionAttribute();
    await publishAndDeliver(onSchemaPublished(inTenant, registry));

    // A later version without the attribute, as a rollback would publish:
    // v1's document with `religion` swapped for an innocuous field.
    await admin.execute(sql`
      INSERT INTO people.schema_version (tenant_id, version, checksum, document, rolled_back_from)
      SELECT tenant_id, 2, ${'0'.repeat(64)},
             jsonb_set(document, '{attributes,0,key}', '"desk"'), 1
        FROM people.schema_version WHERE version = 1
    `);
    await onSchemaPublished(inTenant, registry)({ eventName: 'people.schema.published', tenantId: ACME });

    const { base, lines } = capture();
    registry.loggerFor(base, ACME).info({ custom: { religion: RELIGION } }, 'after rollback');
    expect(lines.at(-1)).not.toContain(RELIGION);
  });

  it('is refused at the AI gateway once published', async () => {
    const registry = createPolicyRegistry({ unknownTenantRedaction: [] });
    await wirePolicyRegistry(inTenant, [ACME], registry);
    let sent = 0;
    const gateway = aiGateway({
      registry,
      send: () => {
        sent += 1;
        return Promise.resolve('ok');
      },
    });
    const prompt = { instruction: 'Summarise', context: { custom: { religion: RELIGION } } };

    await expect(gateway.complete(ACME, prompt)).resolves.toMatchObject({ ok: true });

    await createReligionAttribute();
    await publishAndDeliver(onSchemaPublished(inTenant, registry));

    await expect(gateway.complete(ACME, prompt)).resolves.toMatchObject({
      ok: false,
      error: { code: 'AI_FIELD_DENIED' },
    });
    expect(sent).toBe(1);
  });
});
