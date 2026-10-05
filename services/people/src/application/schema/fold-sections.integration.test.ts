import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { fixedClock } from '@kithena/domain-kit';
import { startPostgres } from '@kithena/testing';

import {
  drizzleDraftWriter,
  drizzlePeopleFacts,
  drizzleSchemaRepository,
} from '../../infrastructure/drizzle-schema-repository.js';
import { tenantTransaction } from '../../infrastructure/unit-of-work.js';
import { utcCalendars } from '../org/org.js';
import { FOLD_REASON, foldSections } from './fold-sections.js';
import { publishSchema } from './publish-schema.js';

/**
 * Two "Personal information" and two "Employment" sections, as an import left
 * one company, folded into one of each as a published version — and a second
 * run that finds nothing to do. Then the trigger, refusing a new duplicate.
 */

const ACME = '00000000-0000-4000-8000-00000000000a';
const clock = fixedClock('2026-10-05T09:00:00.000Z');

let stopPg: (() => Promise<void>) | undefined;
let adminClient: ReturnType<typeof postgres> | undefined;
let serviceClient: ReturnType<typeof postgres> | undefined;
let admin: PostgresJsDatabase;
let inTenant: ReturnType<typeof tenantTransaction>;

let events = 0;
const schema = drizzleSchemaRepository();
const publisher = publishSchema({
  calendars: utcCalendars,
  schema,
  people: drizzlePeopleFacts(),
  clock,
  newEventId: () => {
    events += 1;
    return `01890000-0000-7000-8000-${String(events).padStart(12, '0')}`;
  },
});
const fold = foldSections({
  schema,
  draft: drizzleDraftWriter(),
  publisher,
  clock,
  artifactUrl: (v) => `https://api.kithena.test/v1/schema/versions/${String(v)}`,
});

const migration = (file: string): Promise<string> =>
  readFile(new URL(`../../../../../migrations/${file}`, import.meta.url), 'utf8');

const rows = async (query: ReturnType<typeof sql>) => [...(await admin.execute(query))];

async function section(key: string, label: string, ord: number, origin = 'tenant') {
  await admin.execute(sql`
    INSERT INTO people.section (tenant_id, key, labels, ord, visibility, origin)
    VALUES (${ACME}::uuid, ${key}, ${JSON.stringify({ default: label })}::jsonb, ${ord},
            ${'{"self","hr"}'}::text[], ${origin})`);
}

async function field(key: string, sectionKey: string, ord: number) {
  await admin.execute(sql`
    INSERT INTO people.attribute_definition (
      tenant_id, key, section_key, labels, ord, data_type, type_config, cardinality,
      requiredness, ownership, visibility, collect_at, classification, classification_source, origin
    ) VALUES (
      ${ACME}::uuid, ${key}, ${sectionKey}, ${JSON.stringify({ default: key })}::jsonb, ${ord},
      'text', ${JSON.stringify({ kind: 'text' })}::jsonb, 'single',
      ${JSON.stringify({ mode: 'never' })}::jsonb, ${'{"hr"}'}::text[], ${'{"self","hr"}'}::text[],
      'hr_only',
      ${JSON.stringify({ classification: 'internal', piiKind: 'none', exportable: true, aiEligible: false })}::jsonb,
      'human', 'tenant')`);
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
    '20260926180000_people_pending_change.sql',
    '20260926230000_people_pending_change_decided_as.sql',
    '20260922170000_people_person.sql',
    '20260924220000_people_access_end.sql',
    '20260926143000_people_duplicates.sql',
    '20260924220200_people_employment_period.sql',
    '20260923110000_people_completeness.sql',
    '20260924170000_people_calendar.sql',
    '20260924170100_people_tenant_company.sql',
    '20261005090000_people_org_unit.sql',
    '20261005120000_people_section_names.sql',
  ]) {
    await admin.execute(sql.raw(await migration(file)));
  }
  await admin.execute(sql`ALTER ROLE svc_people LOGIN PASSWORD 'svc_people'`);
  const asService = new URL(pg.url);
  asService.username = 'svc_people';
  asService.password = 'svc_people';
  serviceClient = postgres(asService.toString(), { max: 4 });
  inTenant = tenantTransaction(drizzle(serviceClient));

  // What production holds: the duplicates predate the trigger, so it is off
  // while they are written, exactly as they were.
  await admin.execute(sql`ALTER TABLE people.section DISABLE TRIGGER section_name_is_unique`);
  await section('personal', 'Personal information', 0, 'core');
  await section('employment', 'Employment', 1, 'core');
  await section('personal_information', 'Personal information', 2);
  await section('employment_2', ' employment', 3);
  await admin.execute(sql`ALTER TABLE people.section ENABLE TRIGGER section_name_is_unique`);
  await field('given_name', 'personal', 0);
  await field('work_email', 'employment', 0);
  await field('linkedin_profile_url', 'personal_information', 0);
  await field('hr_notes_category', 'employment_2', 0);
  await admin.execute(sql`
    INSERT INTO people.person (tenant_id, status, given_name, custom)
    VALUES (${ACME}::uuid, 'active', 'Ada',
            ${JSON.stringify({ linkedin_profile_url: 'https://example.test/ada', hr_notes_category: 'general' })}::jsonb)`);

  const first = await inTenant(ACME, ({ tx }) =>
    publisher.publish(tx, {
      tenantId: ACME,
      actor: { kind: 'system', process: 'integration-test' },
      publishedBy: null,
      correlationId: '00000000-0000-4000-8000-0000000000c1',
      artifactUrl: 'https://api.kithena.test/v1/schema/versions/1',
    }),
  );
  expect(first.ok).toBe(true);
});

afterAll(async () => {
  await serviceClient?.end();
  await adminClient?.end();
  await stopPg?.();
});

describe('folding duplicate sections', () => {
  it('publishes the version in force with each name once, said by the system with its reason', async () => {
    const before = await rows(sql`SELECT custom, updated_at FROM people.person`);
    const folded = await inTenant(ACME, ({ tx }) => fold(tx, ACME, '00000000-0000-4000-8000-0000000000c2'));
    expect(folded.ok && folded.value).toEqual({
      version: 2,
      folds: [
        { into: 'personal', from: ['personal_information'], moved: ['linkedin_profile_url'] },
        { into: 'employment', from: ['employment_2'], moved: ['hr_notes_category'] },
      ],
    });

    const [version] = await rows(sql`
      SELECT version, published_by, reason, document FROM people.schema_version
       WHERE tenant_id = ${ACME}::uuid ORDER BY version DESC LIMIT 1`);
    expect(version).toMatchObject({ version: 2, published_by: null, reason: FOLD_REASON });
    const document = version?.['document'] as {
      sections: { key: string }[];
      attributes: { key: string; sectionKey: string; order: number }[];
    };
    expect(document.sections.map((s) => s.key)).toEqual(['personal', 'employment']);
    expect(
      Object.fromEntries(document.attributes.map((a) => [a.key, [a.sectionKey, a.order]])),
    ).toEqual({
      given_name: ['personal', 0],
      linkedin_profile_url: ['personal', 1],
      work_email: ['employment', 0],
      hr_notes_category: ['employment', 1],
    });

    // The draft says the same, the emptied sections archived rather than deleted.
    expect(
      await rows(sql`SELECT key, archived_at IS NOT NULL AS archived FROM people.section ORDER BY ord`),
    ).toEqual([
      { key: 'personal', archived: false },
      { key: 'employment', archived: false },
      { key: 'personal_information', archived: true },
      { key: 'employment_2', archived: true },
    ]);
    expect(
      await rows(sql`SELECT key, section_key FROM people.attribute_definition ORDER BY key`),
    ).toEqual([
      { key: 'given_name', section_key: 'personal' },
      { key: 'hr_notes_category', section_key: 'employment' },
      { key: 'linkedin_profile_url', section_key: 'personal' },
      { key: 'work_email', section_key: 'employment' },
    ]);

    const [event] = await rows(sql`
      SELECT envelope FROM people.outbox
       WHERE event_name = 'people.schema.published' ORDER BY event_id DESC LIMIT 1`);
    expect(event?.['envelope']).toMatchObject({
      actor: { kind: 'system', process: 'people-schema-fold' },
      payload: { schemaVersion: 2, reason: FOLD_REASON, counts: { sections: 2, attributes: 4 } },
    });

    // No person's record is touched: only definitions moved.
    expect(await rows(sql`SELECT custom, updated_at FROM people.person`)).toEqual(before);
  });

  it('changes nothing the second time', async () => {
    const count = async () =>
      rows(sql`SELECT
        (SELECT count(*)::int FROM people.schema_version) AS versions,
        (SELECT count(*)::int FROM people.outbox) AS events,
        (SELECT max(updated_at) FROM people.section) AS sections,
        (SELECT max(updated_at) FROM people.attribute_definition) AS fields`);
    const before = await count();
    const again = await inTenant(ACME, ({ tx }) => fold(tx, ACME, '00000000-0000-4000-8000-0000000000c3'));
    expect(again.ok && again.value).toEqual({ version: null, folds: [] });
    expect(await count()).toEqual(before);
  });

  it('is refused a new section of a name the company has, by the database too', async () => {
    const insert = (key: string, label: string, archived: boolean) =>
      inTenant(ACME, ({ tx }) =>
        tx.execute(sql`
          INSERT INTO people.section (tenant_id, key, labels, ord, visibility, origin, archived_at)
          VALUES (${ACME}::uuid, ${key}, ${JSON.stringify({ default: label })}::jsonb, 9,
                  ${'{"hr"}'}::text[], 'tenant', ${archived ? clock.instant() : null}::timestamptz)`),
      );
    const refused = await insert('jobs', '  EMPLOYMENT ', false).catch((error: unknown) => error);
    expect((refused as { cause?: unknown }).cause).toMatchObject({
      code: '23505',
      message: 'A section called "Employment" already exists',
    });
    // Two writers at once, each unable to see the other's row: one wins.
    const racing = (key: string) =>
      inTenant(ACME, async ({ tx }) => {
        await tx.execute(sql`
          INSERT INTO people.section (tenant_id, key, labels, ord, visibility, origin)
          VALUES (${ACME}::uuid, ${key}, ${JSON.stringify({ default: 'Benefits' })}::jsonb, 9,
                  ${'{"hr"}'}::text[], 'tenant')`);
        await tx.execute(sql`SELECT pg_sleep(0.2)`);
      });
    const raced = await Promise.allSettled([racing('benefits'), racing('benefits_2')]);
    expect(raced.map((r) => r.status).toSorted()).toEqual(['fulfilled', 'rejected']);
    // An archived one is no clash, and neither is another name.
    await expect(insert('old_employment', 'Employment', true)).resolves.toBeDefined();
    await expect(insert('equipment', 'Equipment', false)).resolves.toBeDefined();
  });
});
