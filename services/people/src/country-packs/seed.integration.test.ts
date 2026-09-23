import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { fixedClock } from '@kithena/domain-kit';
import { startPostgres } from '@kithena/testing';

import { publishSchema } from '../application/schema/publish-schema.js';
import {
  drizzlePeopleFacts,
  drizzleSchemaRepository,
} from '../infrastructure/drizzle-schema-repository.js';
import { tenantTransaction } from '../infrastructure/unit-of-work.js';
import { COUNTRY_PACKS, type PackCountry } from './packs.js';
import { seedCountryPack } from './seed.js';
import { utcCalendars } from '../application/org/org.js';

/**
 * PEO-059's "done when": a pack applied to a fresh tenant publishes as
 * version 1 — through the real tables, their constraints and RLS, and the
 * real `publishSchema`.
 */

const ACME = '00000000-0000-4000-8000-00000000000a';
const clock = fixedClock('2026-09-23T09:00:00.000Z');

let stopPg: (() => Promise<void>) | undefined;
let adminClient: ReturnType<typeof postgres> | undefined;
let serviceClient: ReturnType<typeof postgres> | undefined;
let admin: PostgresJsDatabase;
let inTenant: ReturnType<typeof tenantTransaction>;

let events = 0;
const use = publishSchema({ calendars: utcCalendars,
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
  actor: { kind: 'system', process: 'country-pack' } as const,
  publishedBy: null,
  correlationId: '00000000-0000-4000-8000-0000000000c1',
  artifactUrl: 'https://api.kithena.test/v1/people/schema/1',
};

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
    '20260922170000_people_person.sql',
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
});

describe('a country pack on a fresh tenant', () => {
  it.each(Object.keys(COUNTRY_PACKS) as PackCountry[])('%s publishes as version 1', async (country) => {
    const seeded = await inTenant(ACME, ({ tx }) => seedCountryPack(tx, ACME, COUNTRY_PACKS[country]));
    expect(seeded.ok).toBe(true);

    const published = await inTenant(ACME, ({ tx }) => use.publish(tx, request));
    expect(published.ok).toBe(true);
    if (!published.ok) return;

    expect(published.value.version.version).toBe(1);
    expect(published.value.version.document.attributes.map((a) => a.key).toSorted()).toEqual(
      COUNTRY_PACKS[country].attributes.map((a) => a.key).toSorted(),
    );

    const origins = await admin.execute(sql`SELECT DISTINCT origin FROM people.attribute_definition`);
    expect([...origins].map((r) => r['origin'])).toEqual(['country_pack']);
  });

  it('takes a second country and a re-application without a conflict', async () => {
    await inTenant(ACME, async ({ tx }) => {
      await seedCountryPack(tx, ACME, COUNTRY_PACKS.ES);
      await seedCountryPack(tx, ACME, COUNTRY_PACKS.DE);
      await seedCountryPack(tx, ACME, COUNTRY_PACKS.ES);
    });

    const published = await inTenant(ACME, ({ tx }) => use.publish(tx, request));
    expect(published.ok && published.value.version.document.attributes).toHaveLength(4);
  });
});
