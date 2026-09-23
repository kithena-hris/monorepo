import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { PersonProvisioned } from '@kithena/contracts';
import { fixedClock, ok } from '@kithena/domain-kit';
import { startPostgres } from '@kithena/testing';

import { knownTenants, rememberTenant } from '../tenants.js';
import { tenantTransaction } from '../unit-of-work.js';
import { orgAdmin } from '../../application/org/org.js';
import { drizzleOrgStore } from '../drizzle-org-store.js';
import { peopleConsumer } from './handle.js';
import { drizzleProvisionalPeople } from './identity.js';

/**
 * PEO-027: `identity.account.provisioned` becomes a provisional person, once.
 *
 * Driven through the same entry point the Kafka loop calls, with the envelope
 * exactly as identity's outbox writes it.
 */

const ACME = '00000000-0000-4000-8000-00000000000a';
const OTHER = '00000000-0000-4000-8000-00000000000b';
const ACCOUNT = '00000000-0000-4000-8000-0000000000a1';
const clock = fixedClock('2026-09-23T09:00:00.000Z');

let stopPg: (() => Promise<void>) | undefined;
let adminClient: ReturnType<typeof postgres> | undefined;
let serviceClient: ReturnType<typeof postgres> | undefined;
let admin: PostgresJsDatabase;
let handle: ReturnType<typeof peopleConsumer>;
let recomputed = 0;

let ids = 0;
const newEventId = () => {
  ids += 1;
  return `01890000-0000-7000-8000-${String(ids).padStart(12, '0')}`;
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
    '20260923160000_people_tenant.sql',
    '20260924170000_people_calendar.sql',
    '20260924170100_people_tenant_company.sql',
    '20260924230100_people_entitlements.sql',
  ]) {
    await admin.execute(sql.raw(await migration(file)));
  }
  await admin.execute(sql`ALTER ROLE svc_people LOGIN PASSWORD 'svc_people'`);

  const asService = new URL(pg.url);
  asService.username = 'svc_people';
  asService.password = 'svc_people';
  serviceClient = postgres(asService.toString(), { max: 4 });

  handle = peopleConsumer({
    inTenant: tenantTransaction(drizzle(serviceClient)),
    provisional: drizzleProvisionalPeople({ clock, newEventId }),
    recompute: () => {
      recomputed += 1;
      return Promise.resolve(
        ok({ evaluated: 0, becameIncomplete: 0, becameComplete: 0, superseded: false }),
      );
    },
    org: orgAdmin({ store: drizzleOrgStore(), clock, newId: newEventId }),
  });
});

afterAll(async () => {
  await serviceClient?.end();
  await adminClient?.end();
  await stopPg?.();
});

beforeEach(async () => {
  await admin.execute(sql`DELETE FROM people.outbox`);
  await admin.execute(sql`DELETE FROM people.person`);
  await admin.execute(sql`TRUNCATE people.tenant`);
});

function envelope(eventName: string, payload: object, tenantId = ACME) {
  return {
    eventId: newEventId(),
    eventName,
    eventVersion: 1,
    tenantId,
    occurredAt: '2026-09-23T08:59:00.000Z',
    recordedAt: '2026-09-23T08:59:00.000Z',
    effectiveFrom: '2026-10-01',
    aggregate: { type: 'Account', id: ACCOUNT, version: 1 },
    actor: { kind: 'system', process: 'identity' },
    correlationId: '00000000-0000-4000-8000-0000000000c1',
    causationId: null,
    payload,
  };
}

const provisioned = (tenantId = ACME) =>
  envelope(
    'identity.account.provisioned',
    {
      accountId: ACCOUNT,
      identityId: '00000000-0000-4000-8000-0000000000d1',
      workEmail: 'ines@acme.test',
      timeZone: 'Europe/Madrid',
      employmentStart: '2026-10-01',
      via: 'admin_api',
    },
    tenantId,
  );

const captured = (name = { given: 'Inés', family: 'García', preferred: null }) =>
  envelope('identity.account.profile_captured', {
    accountId: ACCOUNT,
    identityId: '00000000-0000-4000-8000-0000000000d1',
    name,
    timeZone: 'Atlantic/Canary',
    mobilePresent: true,
    capturedAt: '2026-09-23T09:00:00.000Z',
  });

async function people() {
  return [
    ...(await admin.execute(sql`
      SELECT tenant_id, identity_account_id, status, work_email, hire_date::text AS hire_date,
             custom, completeness, given_name, family_name, preferred_name
        FROM people.person ORDER BY tenant_id
    `)),
  ];
}

async function outboxCount(): Promise<number> {
  const rows = await admin.execute(sql`SELECT count(*)::int AS n FROM people.outbox`);
  return Number([...rows][0]?.['n']);
}

describe('identity.account.provisioned', () => {
  it('creates a provisional person holding only what the account knew, within a second', async () => {
    const started = performance.now();
    expect(await handle(provisioned())).toBe('applied');
    const [person] = await people();
    expect(performance.now() - started).toBeLessThan(1000);

    expect(person).toMatchObject({
      tenant_id: ACME,
      identity_account_id: ACCOUNT,
      status: 'provisional',
      work_email: 'ines@acme.test',
      hire_date: '2026-10-01',
      custom: { time_zone: 'Europe/Madrid' },
      // No required-field evaluation, so nothing to nag about.
      completeness: 'not_applicable',
      given_name: null,
    });

    const gaps = await admin.execute(sql`SELECT count(*)::int AS n FROM people.completeness_gap`);
    expect(Number([...gaps][0]?.['n'])).toBe(0);
  });

  it('raises people.person.provisioned, caused by the identity event', async () => {
    const incoming = provisioned();
    await handle(incoming);

    const rows = await admin.execute(sql`SELECT envelope FROM people.outbox`);
    const event = PersonProvisioned.parse([...rows][0]?.['envelope']) as {
      causationId: string;
      payload: { identityAccountId: string; employmentStart: string };
    };
    expect(event.causationId).toBe(incoming.eventId);
    expect(event.payload).toMatchObject({
      identityAccountId: ACCOUNT,
      employmentStart: '2026-10-01',
    });
  });

  it('is idempotent on identityAccountId: a redelivery writes no row and no event', async () => {
    expect(await handle(provisioned())).toBe('applied');
    expect(await handle(provisioned())).toBe('unchanged');

    expect(await people()).toHaveLength(1);
    expect(await outboxCount()).toBe(1);
  });

  it('stays idempotent when two deliveries race', async () => {
    // Both pass any lookup a check-then-insert would do; only the index can
    // stop the second.
    const outcomes = await Promise.all([handle(provisioned()), handle(provisioned())]);
    expect(outcomes.toSorted()).toEqual(['applied', 'unchanged']);
    expect(await people()).toHaveLength(1);
    expect(await outboxCount()).toBe(1);
  });

  it('keeps the same account id in two tenants apart', async () => {
    await handle(provisioned(ACME));
    expect(await handle(provisioned(OTHER))).toBe('applied');
    expect((await people()).map((p) => p['tenant_id'])).toEqual([ACME, OTHER]);
  });

  it('skips an envelope that does not match its contract, rather than retrying it forever', async () => {
    const broken = { ...provisioned(), payload: { accountId: ACCOUNT } };
    expect(await handle(broken)).toBe('rejected');
    expect(await people()).toHaveLength(0);
  });

  it('ignores identity events People does not read', async () => {
    expect(await handle(envelope('identity.session.started', {}))).toBe('ignored');
  });
});

describe('identity.account.profile_captured', () => {
  it('fills the name onto the provisional person, and takes identity’s time zone', async () => {
    await handle(provisioned());
    expect(await handle(captured())).toBe('applied');

    expect((await people())[0]).toMatchObject({
      given_name: 'Inés',
      family_name: 'García',
      preferred_name: null,
      custom: { time_zone: 'Atlantic/Canary' },
      status: 'provisional',
    });
  });

  it('never overwrites a name People already holds', async () => {
    await handle(provisioned());
    await handle(captured());
    await handle(captured({ given: 'Someone', family: 'Else', preferred: null }));

    expect((await people())[0]).toMatchObject({ given_name: 'Inés', family_name: 'García' });
  });

  it('does nothing for an account People has no person for', async () => {
    expect(await handle(captured())).toBe('unchanged');
    expect(await people()).toHaveLength(0);
  });
});

describe('people.schema.published', () => {
  it('runs the completeness recompute', async () => {
    const before = recomputed;
    const outcome = await handle(
      envelope('people.schema.published', {
        schemaVersion: 1,
        checksum: 'a'.repeat(64),
        counts: { sections: 1, attributes: 1, added: 1, tightened: 0, archived: 0 },
        artifactUrl: 'https://api.kithena.test/v1/people/schema/1',
      }),
    );
    expect(outcome).toBe('applied');
    expect(recomputed).toBe(before + 1);
  });
});

describe('the tenant list (PEO-080)', () => {
  const service = () => drizzle(serviceClient as ReturnType<typeof postgres>);

  it('records the tenant of every account provisioned, once', async () => {
    await handle(provisioned(ACME));
    await handle(provisioned(ACME));
    await handle(provisioned(OTHER));
    // Read as `svc_people` with no tenant set: the one table that answers.
    expect(await knownTenants(service())).toEqual([ACME, OTHER]);
  });

  it('records the tenant of a schema publish', async () => {
    await handle(
      envelope('people.schema.published', {
        schemaVersion: 1,
        checksum: 'a'.repeat(64),
        counts: { sections: 1, attributes: 1, added: 1, tightened: 0, archived: 0 },
        artifactUrl: 'https://api.kithena.test/v1/people/schema/1',
      }),
    );
    expect(await knownTenants(service())).toEqual([ACME]);
  });

  it('lets a unit of work register only its own tenant', async () => {
    await expect(
      tenantTransaction(service())(ACME, ({ tx }) => rememberTenant(tx, OTHER)),
    ).rejects.toThrow();
    expect(await knownTenants(service())).toEqual([]);
  });

  it('never forgets one: svc_people has no UPDATE or DELETE', async () => {
    await handle(provisioned(ACME));
    await expect(service().execute(sql`DELETE FROM people.tenant`)).rejects.toThrow();
    await expect(
      service().execute(sql`UPDATE people.tenant SET first_seen_at = now()`),
    ).rejects.toThrow();
  });
});

describe('identity.tenant.* (PEO-099)', () => {
  const tenantEvent = (eventName: string, payload: object, occurredAt: string) => ({
    ...envelope(eventName, payload),
    occurredAt,
    effectiveFrom: null,
    aggregate: { type: 'Tenant', id: ACME, version: 1 },
  });
  const created = tenantEvent(
    'identity.tenant.provisioned',
    { slug: 'acme', displayName: 'Acme', country: 'ES', timeZone: 'Europe/Madrid' },
    '2026-09-23T09:00:00.000Z',
  );
  const settings = async () =>
    [
      ...(await admin.execute(sql`
        SELECT default_time_zone, slug, display_name FROM people.tenant_settings
         WHERE tenant_id = ${ACME}::uuid`)),
    ][0];
  const entities = async () =>
    [
      ...(await admin.execute(
        sql`SELECT name, country, time_zone FROM people.legal_entity WHERE tenant_id = ${ACME}::uuid`,
      )),
    ];

  beforeEach(async () => {
    await admin.execute(sql`DELETE FROM people.legal_entity`);
    await admin.execute(sql`DELETE FROM people.tenant_settings`);
  });

  it('takes the default zone, a first legal entity, the slug and the name, once', async () => {
    expect(await handle(created)).toBe('applied');
    expect(await handle(created)).toBe('unchanged');
    expect(await settings()).toEqual({
      default_time_zone: 'Europe/Madrid',
      slug: 'acme',
      display_name: 'Acme',
    });
    expect(await entities()).toEqual([{ name: 'Acme', country: 'ES', time_zone: 'Europe/Madrid' }]);
    expect([...(await admin.execute(sql`SELECT tenant_id FROM people.tenant`))]).toEqual([
      { tenant_id: ACME },
    ]);
  });

  it('follows a rename, and ignores one delivered after a later one', async () => {
    await handle(created);
    const renamed = (displayName: string, at: string) =>
      tenantEvent('identity.tenant.amended', { slug: 'acme', displayName }, at);
    expect(await handle(renamed('Acme Iberia', '2026-09-25T09:00:00.000Z'))).toBe('applied');
    expect(await handle(renamed('Acme Old', '2026-09-24T09:00:00.000Z'))).toBe('unchanged');
    expect(await settings()).toMatchObject({ display_name: 'Acme Iberia' });
  });
});

describe('identity.tenant.entitlements_changed (PEO-114)', () => {
  const changed = (entitlements: string[], occurredAt: string) => ({
    ...envelope('identity.tenant.entitlements_changed', { entitlements }),
    occurredAt,
    effectiveFrom: null,
    aggregate: { type: 'Tenant', id: ACME, version: 1 },
  });
  const kept = async () =>
    [
      ...(await admin.execute(sql`
        SELECT entitlements FROM people.tenant_settings WHERE tenant_id = ${ACME}::uuid`)),
    ][0]?.['entitlements'];

  beforeEach(async () => {
    await admin.execute(sql`DELETE FROM people.tenant_settings`);
  });

  it('keeps the company’s modules, and ignores a change delivered after a later one', async () => {
    expect(await handle(changed(['module.people'], '2026-09-25T09:00:00.000Z'))).toBe('applied');
    expect(await handle(changed([], '2026-09-24T09:00:00.000Z'))).toBe('unchanged');
    expect(await kept()).toEqual(['module.people']);
    expect(await handle(changed([], '2026-09-26T09:00:00.000Z'))).toBe('applied');
    expect(await kept()).toEqual([]);
  });

  it('refuses a module that does not exist, keeping nothing', async () => {
    expect(await handle(changed(['module.crypto'], '2026-09-25T09:00:00.000Z'))).toBe('rejected');
    expect(await kept()).toBeUndefined();
  });
});
