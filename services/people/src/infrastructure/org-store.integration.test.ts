import { readdir, readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { fixedClock } from '@kithena/domain-kit';
import { startPostgres } from '@kithena/testing';

import { personZone } from '../domain/org/calendar.js';
import { orgAdmin } from '../application/org/org.js';
import { drizzleOrgStore } from './drizzle-org-store.js';
import { tenantTransaction, type InTenantTransaction } from './unit-of-work.js';

/**
 * `20260924170000_people_calendar.sql` against a real database, as
 * `svc_people`: every new table isolates its tenant, the cohort minimum is
 * never lowered even by a statement that skips the domain, a location's zone
 * history is append-only, and the resolver reads back what the use cases wrote.
 */

const ACME = '00000000-0000-4000-8000-00000000000a';
const GLOBEX = '00000000-0000-4000-8000-00000000000b';
const ADMIN = {
  viewer: { accountId: '00000000-0000-4000-8000-0000000000a1', roles: new Set(['people_admin']) },
  correlationId: '00000000-0000-4000-8000-0000000000c1',
};

let stopPg: (() => Promise<void>) | undefined;
let adminClient: ReturnType<typeof postgres> | undefined;
let serviceClient: ReturnType<typeof postgres> | undefined;
let inTenant: InTenantTransaction;
let asPeople: PostgresJsDatabase;

const migrations = new URL('../../../../migrations/', import.meta.url);

beforeAll(async () => {
  const pg = await startPostgres();
  stopPg = pg.stop;
  adminClient = postgres(pg.url, { max: 1 });
  const admin = drizzle(adminClient);
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
  serviceClient = postgres(asService.toString(), { max: 2 });
  asPeople = drizzle(serviceClient);
  inTenant = tenantTransaction(asPeople);
});

afterAll(async () => {
  await serviceClient?.end();
  await adminClient?.end();
  await stopPg?.();
});

/** What Postgres said, under Drizzle's "Failed query" wrapper. */
async function refusal(work: Promise<unknown>): Promise<string> {
  return work.then(
    () => 'accepted',
    (error: unknown) => String((error as { cause?: { message?: string } }).cause?.message ?? error),
  );
}

let n = 0;
const org = orgAdmin({
  store: drizzleOrgStore(),
  clock: fixedClock('2026-03-31T20:00:00.000Z'),
  newId: () => `01900000-0000-7000-8000-${String((n += 1)).padStart(12, '0')}`,
});

describe('legal entities and locations, in Postgres', () => {
  it('round-trips through the resolver, each entity on its own zone', async () => {
    const calendar = await inTenant(ACME, async ({ tx, tenantId }) => {
      const madrid = await org.createLegalEntity(tx, {
        ...ADMIN,
        tenantId,
        name: 'Acme SL',
        country: 'ES',
        timeZone: 'Europe/Madrid',
      });
      const india = await org.createLegalEntity(tx, {
        ...ADMIN,
        tenantId,
        name: 'Acme India',
        country: 'IN',
        timeZone: 'Asia/Kolkata',
      });
      if (!madrid.ok || !india.ok) throw new Error('entities refused');
      const canaries = await org.createLocation(tx, {
        ...ADMIN,
        tenantId,
        legalEntityId: madrid.value.id,
        name: 'Las Palmas',
        country: 'ES',
        timeZone: 'Atlantic/Canary',
        effectiveFrom: '2020-01-01',
      });
      if (!canaries.ok) throw new Error(canaries.error.message);
      return drizzleOrgStore().load(tx, tenantId);
    });

    expect([...calendar.entities.values()].map((e) => e.timeZone).toSorted()).toEqual([
      'Asia/Kolkata',
      'Europe/Madrid',
    ]);
    const [location] = [...calendar.locations.values()];
    expect(
      personZone(
        calendar,
        { locationId: location?.id ?? null, legalEntityId: null, ownZone: null },
        '2026-03-31T20:00:00.000Z',
      ),
    ).toBe('Atlantic/Canary');
  });

  it("shows one tenant nothing of another's", async () => {
    const seen = await inTenant(GLOBEX, async ({ tx }) => ({
      entities: [...(await tx.execute(sql`SELECT id FROM people.legal_entity`))].length,
      locations: [...(await tx.execute(sql`SELECT id FROM people.location`))].length,
      zones: [...(await tx.execute(sql`SELECT id FROM people.location_zone`))].length,
    }));
    expect(seen).toEqual({ entities: 0, locations: 0, zones: 0 });
  });

  it('keeps location zones append-only: the service may not update one', async () => {
    expect(
      await refusal(
        inTenant(ACME, ({ tx }) => tx.execute(sql`UPDATE people.location_zone SET time_zone = 'Etc/UTC'`)),
      ),
    ).toMatch(/permission denied/u);
  });
});

describe('the cohort minimum, in Postgres', () => {
  it('is raised through the use case', async () => {
    const raised = await inTenant(ACME, ({ tx, tenantId }) =>
      org.updateSettings(tx, { ...ADMIN, tenantId, cohortMinimum: 20 }),
    );
    expect(raised).toMatchObject({ ok: true, value: { cohortMinimum: 20 } });
  });

  it('is never lowered, even by a statement that goes round the domain', async () => {
    expect(
      await refusal(
        inTenant(ACME, ({ tx }) => tx.execute(sql`UPDATE people.tenant_settings SET cohort_minimum = 15`)),
      ),
    ).toMatch(/never lowered/u);
  });

  it('never starts below the floor of ten', async () => {
    expect(
      await refusal(
        inTenant(GLOBEX, ({ tx }) =>
          tx.execute(
            sql`INSERT INTO people.tenant_settings (tenant_id, cohort_minimum) VALUES (${GLOBEX}::uuid, 5)`,
          ),
        ),
      ),
    ).toMatch(/tenant_settings_cohort_floor/u);
  });
});
