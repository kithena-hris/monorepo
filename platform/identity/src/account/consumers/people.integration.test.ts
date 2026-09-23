import { readFile } from 'node:fs/promises';

import { sql } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '@kithena/db-kit';
import { fixedClock } from '@kithena/domain-kit';
import { startPostgres } from '@kithena/testing';

import { Account } from '../domain/account.js';
import { drizzleAccountRepository } from '../infrastructure/drizzle-account-repository.js';
import { peopleConsumer } from './people.js';

/**
 * People correcting identity's cached name and start date, against the real
 * table, its constraints and its row-level security.
 */

const TENANT = '00000000-0000-4000-8000-00000000000a';
const OTHER_TENANT = '00000000-0000-4000-8000-00000000000b';
const IDENTITY = '00000000-0000-4000-8000-00000000000d';
const OTHER_IDENTITY = '00000000-0000-4000-8000-00000000000e';
const INVITED = '00000000-0000-4000-8000-0000000000a1';
const ACTIVE = '00000000-0000-4000-8000-0000000000a2';
const ELSEWHERE = '00000000-0000-4000-8000-0000000000a3';

let stop: (() => Promise<void>) | undefined;
let adminClient: ReturnType<typeof postgres> | undefined;
let serviceClient: ReturnType<typeof postgres> | undefined;
let db: PostgresJsDatabase;
let consume: ReturnType<typeof peopleConsumer>;

beforeAll(async () => {
  const started = await startPostgres();
  stop = started.stop;
  adminClient = postgres(started.url, { max: 1 });
  const admin = drizzle(adminClient);

  for (const file of [
    '20260821120000_tenant_registry.sql',
    '20260821230000_identity.sql',
    '20260919160000_account_name.sql',
    '20260921230000_account_mobile.sql',
  ]) {
    const path = new URL(`../../../../../migrations/${file}`, import.meta.url);
    await admin.execute(sql.raw(await readFile(path, 'utf8')));
  }

  await admin.execute(sql`
    INSERT INTO platform.tenant (id, slug, display_name, status) VALUES
      (${TENANT}::uuid, 'acme', 'Acme', 'active'),
      (${OTHER_TENANT}::uuid, 'globex', 'Globex', 'active')
  `);
  await admin.execute(sql`INSERT INTO platform.identity (id) VALUES (${IDENTITY}::uuid), (${OTHER_IDENTITY}::uuid)`);
  await admin.execute(sql`
    INSERT INTO platform.account
      (id, tenant_id, identity_id, status, work_email, time_zone, employment_start, session_limit,
       given_name, family_name)
    VALUES
      (${INVITED}::uuid, ${TENANT}::uuid, ${IDENTITY}::uuid, 'invited',
       'ada@acme.example', 'Europe/Madrid', '2026-04-01', 4, NULL, NULL),
      (${ACTIVE}::uuid, ${TENANT}::uuid, ${OTHER_IDENTITY}::uuid, 'active',
       'grace@acme.example', 'Europe/Madrid', '2026-01-01', 4, 'Grace', 'Murray'),
      (${ELSEWHERE}::uuid, ${OTHER_TENANT}::uuid, ${IDENTITY}::uuid, 'active',
       'ada@globex.example', 'Europe/Madrid', '2026-01-01', 4, 'Ada', 'Globex')
  `);

  // A non-superuser, so row-level security is enforced rather than bypassed.
  await admin.execute(sql`CREATE ROLE svc_test LOGIN PASSWORD 'svc_test' NOBYPASSRLS`);
  await admin.execute(sql`GRANT USAGE ON SCHEMA platform TO svc_test`);
  await admin.execute(sql`GRANT SELECT, UPDATE ON ALL TABLES IN SCHEMA platform TO svc_test`);

  const asService = new URL(started.url);
  asService.username = 'svc_test';
  asService.password = 'svc_test';
  serviceClient = postgres(asService.toString(), { max: 2 });
  db = drizzle(serviceClient);
  consume = peopleConsumer((tenantId, fn) => withTenant(db, tenantId, fn));
});

afterAll(async () => {
  await serviceClient?.end();
  await adminClient?.end();
  await stop?.();
});

let n = 0;
function facts(
  accountId: string,
  payload: { name?: unknown; employmentStart?: string | null },
  tenantId = TENANT,
) {
  n += 1;
  return {
    eventId: `01890000-0000-7000-8000-${String(n).padStart(12, '0')}`,
    eventName: 'people.person.identity_facts_changed',
    eventVersion: 1,
    tenantId,
    occurredAt: '2026-03-20T09:00:00.000Z',
    recordedAt: '2026-03-20T09:00:00.000Z',
    effectiveFrom: null,
    aggregate: { type: 'Person', id: '00000000-0000-4000-8000-0000000000f1', version: 2 },
    actor: { kind: 'system', process: 'test' },
    correlationId: '00000000-0000-4000-8000-0000000000c1',
    causationId: null,
    payload: {
      personId: '00000000-0000-4000-8000-0000000000f1',
      identityAccountId: accountId,
      name: null,
      employmentStart: null,
      ...payload,
    },
  };
}

async function row(accountId: string, tenantId = TENANT) {
  return withTenant(db, tenantId, async (tx) => {
    const rows = await tx.execute<{
      status: string;
      given_name: string | null;
      family_name: string | null;
      preferred_name: string | null;
      employment_start: string;
    }>(sql`
      SELECT status, given_name, family_name, preferred_name, employment_start::text
      FROM platform.account WHERE id = ${accountId}::uuid
    `);
    return rows[0];
  });
}

describe('a corrected start date', () => {
  it('re-gates an invited account, which cannot enrol before the new date', async () => {
    expect(await consume(facts(INVITED, { employmentStart: '2026-05-01' }))).toBe('applied');
    expect((await row(INVITED))?.employment_start).toBe('2026-05-01');

    // The old start has passed; the corrected one has not.
    const refused = await withTenant(db, TENANT, async (tx) => {
      const snapshot = await drizzleAccountRepository().load(tx, INVITED);
      if (!snapshot) throw new Error('no account');
      return Account.rehydrate(snapshot).enrol('01890000-0000-7000-8000-0000000000e1', {
        clock: fixedClock('2026-04-15T09:00:00.000Z'),
        newEventId: () => '01890000-0000-7000-8000-0000000000e2',
        actor: { kind: 'system', process: 'test' },
        correlationId: '00000000-0000-4000-8000-0000000000c1',
        causationId: null,
      });
    });
    expect(!refused.ok && refused.error.code).toBe('EMPLOYMENT_NOT_STARTED');
  });

  it('leaves an active account active', async () => {
    expect(await consume(facts(ACTIVE, { employmentStart: '2026-06-01' }))).toBe('applied');
    expect(await row(ACTIVE)).toMatchObject({ status: 'active', employment_start: '2026-06-01' });
  });
});

describe('a corrected name', () => {
  const name = { given: 'Grace', family: 'Hopper', preferred: 'Amazing Grace' };

  it('replaces all three parts, and a repeat of the same event changes nothing', async () => {
    const event = facts(ACTIVE, { name });
    expect(await consume(event)).toBe('applied');
    const once = await row(ACTIVE);
    expect(await consume(event)).toBe('applied');
    expect(await row(ACTIVE)).toEqual(once);
    expect(once).toMatchObject({
      given_name: 'Grace',
      family_name: 'Hopper',
      preferred_name: 'Amazing Grace',
    });
  });

  it('keeps the cached name when People has none yet, and still takes the start date', async () => {
    expect(await consume(facts(ACTIVE, { name: null, employmentStart: '2026-07-01' }))).toBe(
      'applied',
    );
    expect(await row(ACTIVE)).toMatchObject({ given_name: 'Grace', employment_start: '2026-07-01' });
  });

  it('leaves a name identity cannot store rather than stalling on it', async () => {
    const long = { given: 'G'.repeat(101), family: 'Hopper', preferred: null };
    expect(await consume(facts(ACTIVE, { name: long, employmentStart: '2026-08-01' }))).toBe(
      'applied',
    );
    expect(await row(ACTIVE)).toMatchObject({ given_name: 'Grace', employment_start: '2026-08-01' });
  });
});

describe('what it will not do', () => {
  it('cannot reach an account in another tenant', async () => {
    const crossing = facts(ELSEWHERE, { employmentStart: '2030-01-01' });
    expect(await consume(crossing)).toBe('unchanged');
    expect((await row(ELSEWHERE, OTHER_TENANT))?.employment_start).toBe('2026-01-01');
  });

  it('skips a malformed event instead of throwing', async () => {
    expect(await consume(facts(ACTIVE, { employmentStart: 'next monday' }))).toBe('rejected');
  });

  it('ignores every other event on the topic', async () => {
    expect(await consume({ eventName: 'people.person.hired' })).toBe('ignored');
  });
});
