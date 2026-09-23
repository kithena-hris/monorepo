import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { fixedClock } from '@kithena/domain-kit';
import { startPostgres } from '@kithena/testing';

import { assessCompleteness } from '../../domain/person/completeness.js';
import {
  drizzlePeopleFacts,
  drizzleSchemaRepository,
} from '../../infrastructure/drizzle-schema-repository.js';
import { tenantTransaction } from '../../infrastructure/unit-of-work.js';
import { publishSchema } from './publish-schema.js';
import { utcCalendars } from '../org/org.js';

/**
 * Publishing a version, and the number shown before it happens.
 *
 * The ticket's acceptance is that **the preview matches what the recompute
 * produces**, and that is the only property here worth the cost of a database.
 * A preview computed one way and a recompute computed another would agree on
 * the day they were written and drift by the first conditional requirement —
 * and the number would still be shown, and still be believed.
 *
 * So the test publishes a tightening version over a seeded tenant, then walks
 * every person itself with the published document and counts. The two have to
 * be the same number.
 */

const ACME = '00000000-0000-4000-8000-00000000000a';
const clock = fixedClock('2026-09-22T09:00:00.000Z');

let stopPg: (() => Promise<void>) | undefined;
let adminClient: ReturnType<typeof postgres> | undefined;
let serviceClient: ReturnType<typeof postgres> | undefined;
let admin: PostgresJsDatabase;
let inTenant: ReturnType<typeof tenantTransaction>;

let events = 0;
const use = publishSchema({
  calendars: utcCalendars,
  schema: drizzleSchemaRepository(),
  people: drizzlePeopleFacts(),
  clock,
  newEventId: () => {
    events += 1;
    return `01890000-0000-7000-8000-${String(events).padStart(12, '0')}`;
  },
});

const request = {
  tenantId: ACME,
  actor: { kind: 'system', process: 'integration-test' } as const,
  publishedBy: null,
  correlationId: '00000000-0000-4000-8000-0000000000c1',
  artifactUrl: 'https://api.kithena.test/v1/people/schema/1',
};

const migration = (file: string): Promise<string> =>
  readFile(new URL(`../../../../../migrations/${file}`, import.meta.url), 'utf8');

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
    '20260924220000_people_access_end.sql',
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
  await admin.execute(sql`DELETE FROM people.person`);
  await admin.execute(sql`DELETE FROM people.attribute_definition`);
  await admin.execute(sql`DELETE FROM people.section`);

  await admin.execute(sql`
    INSERT INTO people.section (tenant_id, key, labels, ord, visibility, origin)
    VALUES (${ACME}::uuid, 'hr_information',
            ${JSON.stringify({ default: 'HR information' })}::jsonb, 0,
            ${'{"self","hr"}'}::text[], 'core')
  `);
});

/** One attribute, written the way the settings screen would write it. */
async function defineAttribute(
  key: string,
  over: { required?: boolean; ownership?: string; country?: string } = {},
): Promise<void> {
  const requiredness =
    over.country !== undefined
      ? {
          mode: 'conditional',
          when: { combine: 'all', clauses: [{ operand: 'country', in: [over.country] }] },
        }
      : over.required === true
        ? { mode: 'always', requiredFrom: null, appliesTo: 'all_records' }
        : { mode: 'never' };

  await admin.execute(sql`
    INSERT INTO people.attribute_definition (
      tenant_id, key, section_key, labels, ord, data_type, type_config, cardinality,
      requiredness, ownership, visibility, collect_at, classification, classification_source, origin
    ) VALUES (
      ${ACME}::uuid, ${key}, 'hr_information',
      ${JSON.stringify({ default: key })}::jsonb, 0, 'text',
      ${JSON.stringify({ kind: 'text' })}::jsonb, 'single',
      ${JSON.stringify(requiredness)}::jsonb,
      ${`{"${over.ownership ?? 'hr'}"}`}::text[], ${'{"self","hr"}'}::text[], 'hr_only',
      ${JSON.stringify({
        classification: 'internal',
        piiKind: 'none',
        exportable: true,
        aiEligible: true,
      })}::jsonb,
      'human', 'tenant'
    )
    ON CONFLICT (tenant_id, key) DO UPDATE SET requiredness = EXCLUDED.requiredness,
                                               ownership = EXCLUDED.ownership
  `);
}

/** `n` people, `answered` of whom already have a value for `key`. */
async function seedPeople(
  n: number,
  key: string,
  answered: number,
  custom: object = {},
): Promise<void> {
  for (let i = 0; i < n; i += 1) {
    const bag = i < answered ? { ...custom, [key]: `value-${String(i)}` } : custom;
    // eslint-disable-next-line no-await-in-loop -- seeding, in a test
    await admin.execute(sql`
      INSERT INTO people.person (tenant_id, status, given_name, custom)
      VALUES (${ACME}::uuid, 'active', 'Ada', ${JSON.stringify(bag)}::jsonb)
    `);
  }
}

/**
 * The recompute, done here rather than imported.
 *
 * PEO-026 builds the real one — a bounded job that raises an event per person
 * and caps the reminders. What this asserts is the property that job will
 * depend on: walking every person against the published document produces the
 * number the preview showed. Computing it independently here is the point; a
 * test that called the same function twice would prove only that the function
 * is deterministic.
 */
async function recountIncomplete(): Promise<number> {
  const published = await admin.execute(sql`
    SELECT document FROM people.schema_version ORDER BY version DESC LIMIT 1
  `);
  const document = [...published][0]?.['document'] as { attributes: unknown[] };
  const definitions = document.attributes as Parameters<typeof assessCompleteness>[0];

  const rows = await admin.execute(sql`
    SELECT status, legal_entity_id, employment_type, work_model, custom,
           hire_date::text AS hire_date FROM people.person
  `);

  let incomplete = 0;
  for (const row of rows) {
    const custom = (row['custom'] ?? {}) as Record<string, unknown>;
    // A core field lives in its column, not in `custom`, and is as present.
    const values = row['hire_date'] === null ? custom : { ...custom, hire_date: row['hire_date'] };
    const verdict = assessCompleteness(
      definitions,
      {
        legalEntityId: row['legal_entity_id'] as string | null,
        country: typeof custom['country'] === 'string' ? custom['country'] : null,
        employmentType: row['employment_type'] as never,
        workModel: row['work_model'] as never,
        status: row['status'] as never,
        values,
        knownAttributes: new Set(Object.keys(values)),
      },
      clock,
      'Etc/UTC',
    );
    if (verdict.state === 'incomplete') incomplete += 1;
  }
  return incomplete;
}

describe('the preview and the recompute', () => {
  it('agree on how many people become incomplete', async () => {
    // The assertion the ticket is written around. 412 people, 324 of whom have
    // no cost centre; the preview says 324 and the recompute has to find 324.
    await defineAttribute('cost_centre', { required: true });
    await seedPeople(412, 'cost_centre', 88);

    const preview = await inTenant(ACME, ({ tx }) => use.preview(tx, request));
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;

    expect(preview.value.impact).toMatchObject({ evaluated: 412, becomingIncomplete: 324 });

    const published = await inTenant(ACME, ({ tx }) => use.publish(tx, request));
    expect(published.ok).toBe(true);

    expect(await recountIncomplete()).toBe(preview.value.impact.becomingIncomplete);
  });

  it('agree when the requirement applies to one country only', async () => {
    // The case a preview computed a second way would get wrong first.
    await defineAttribute('nif', { country: 'ES' });
    await seedPeople(30, 'nif', 0, { country: 'ES' });
    await seedPeople(70, 'nif', 0, { country: 'DE' });

    const preview = await inTenant(ACME, ({ tx }) => use.preview(tx, request));
    if (!preview.ok) return;

    expect(preview.value.impact).toMatchObject({ evaluated: 100, becomingIncomplete: 30 });

    await inTenant(ACME, ({ tx }) => use.publish(tx, request));
    expect(await recountIncomplete()).toBe(30);
  });

  it('count a required core field everybody has as missing for nobody', async () => {
    // PEO-079: `hire_date` is a column, not a `custom` key. Read from `custom`
    // alone it is missing for all 20, and the preview would say so.
    await defineAttribute('hire_date', { required: true });
    for (let i = 0; i < 20; i += 1) {
      // eslint-disable-next-line no-await-in-loop -- seeding, in a test
      await admin.execute(sql`
        INSERT INTO people.person (tenant_id, status, given_name, hire_date)
        VALUES (${ACME}::uuid, 'active', 'Ada', '2024-01-01')
      `);
    }

    const preview = await inTenant(ACME, ({ tx }) => use.preview(tx, request));
    if (!preview.ok) return;
    expect(preview.value.impact).toMatchObject({ evaluated: 20, becomingIncomplete: 0 });

    await inTenant(ACME, ({ tx }) => use.publish(tx, request));
    expect(await recountIncomplete()).toBe(0);
  });

  it('splits the fields by who has to fill them in', async () => {
    // "61 fields owned by employees, 27 owned by you" — the actionable half.
    await defineAttribute('cost_centre', { required: true, ownership: 'hr' });
    await defineAttribute('bio', { required: true, ownership: 'employee' });
    await seedPeople(10, 'cost_centre', 0);

    const preview = await inTenant(ACME, ({ tx }) => use.preview(tx, request));
    if (!preview.ok) return;

    expect(preview.value.impact.fieldsByOwner).toEqual({ employee: 10, staff: 10 });
    expect(preview.value.ownersAffected).toEqual(['employee', 'hr']);
  });
});

describe('the preview itself', () => {
  beforeEach(async () => {
    await defineAttribute('cost_centre', { required: true });
    await seedPeople(5, 'cost_centre', 0);
  });

  it('writes nothing', async () => {
    await inTenant(ACME, ({ tx }) => use.preview(tx, request));

    const versions = await admin.execute(sql`SELECT count(*)::int AS n FROM people.schema_version`);
    const outbox = await admin.execute(sql`SELECT count(*)::int AS n FROM people.outbox`);
    expect(Number([...versions][0]?.['n'])).toBe(0);
    expect(Number([...outbox][0]?.['n'])).toBe(0);
  });

  it('names the version it would create and what changed', async () => {
    const preview = await inTenant(ACME, ({ tx }) => use.preview(tx, request));
    if (!preview.ok) return;

    expect(preview.value.nextVersion).toBe(1);
    expect(preview.value.diff.added).toEqual(['cost_centre']);
  });
});

describe('publishing', () => {
  beforeEach(async () => {
    await defineAttribute('cost_centre', { required: true });
    await seedPeople(3, 'cost_centre', 0);
  });

  it('writes the version and its event together', async () => {
    const published = await inTenant(ACME, ({ tx }) => use.publish(tx, request));
    expect(published.ok).toBe(true);

    const rows = await admin.execute(sql`
      SELECT event_name, envelope FROM people.outbox
    `);
    const event = [...rows][0];
    // Asserted rather than optionally chained: an absent row is the failure
    // this test is looking for, and `event?.envelope` would report it as a
    // TypeError somewhere further down instead.
    expect(event).toBeDefined();
    if (!event) return;

    expect(event['event_name']).toBe('people.schema.published');

    const payload = (event['envelope'] as { payload: Record<string, unknown> }).payload;
    expect(payload).toMatchObject({
      schemaVersion: 1,
      counts: { sections: 1, attributes: 1, added: 1, tightened: 0, archived: 0 },
      artifactUrl: request.artifactUrl,
    });
    // The document is fetched by version, never carried.
    expect(payload).not.toHaveProperty('document');
  });

  it('counts the next version up', async () => {
    await inTenant(ACME, ({ tx }) => use.publish(tx, request));
    await defineAttribute('bio', { required: true });

    const second = await inTenant(ACME, ({ tx }) => use.publish(tx, request));
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.version.version).toBe(2);
  });

  it('refuses a version identical to the one in force', async () => {
    // Every publish tells every integration to re-read the artifact. A
    // Publish button pressed twice should not send three of them after a
    // document that did not change.
    await inTenant(ACME, ({ tx }) => use.publish(tx, request));

    const again = await inTenant(ACME, ({ tx }) => use.publish(tx, request));
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.error.code).toBe('SCHEMA_UNCHANGED');
  });

  it('refuses to publish a registry with no fields', async () => {
    await admin.execute(sql`DELETE FROM people.attribute_definition`);

    const empty = await inTenant(ACME, ({ tx }) => use.publish(tx, request));
    expect(empty.ok).toBe(false);
    if (empty.ok) return;
    expect(empty.error.code).toBe('NOTHING_TO_PUBLISH');
  });

  it('leaves the version unwritten when the transaction rolls back', async () => {
    await expect(
      inTenant(ACME, async ({ tx }) => {
        await use.publish(tx, request);
        throw new Error('the rest of the use case refused');
      }),
    ).rejects.toThrow();

    const rows = await admin.execute(sql`SELECT count(*)::int AS n FROM people.schema_version`);
    expect(Number([...rows][0]?.['n'])).toBe(0);
  });
});
