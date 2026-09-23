import { readFile } from 'node:fs/promises';

import { sql } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '@kithena/db-kit';
import { fixedClock } from '@kithena/domain-kit';
import { startPostgres } from '@kithena/testing';

import { authenticate } from '../application/authenticate.js';
import { startSession } from '../application/start-session.js';
import type { EventContext } from '../domain/account.js';
import { drizzleAccountRepository, loadSession } from '../infrastructure/drizzle-account-repository.js';
import { peopleConsumer } from './people.js';

/**
 * PEO-109: access ends with employment, against the real tables and their
 * row-level security.
 *
 * People says when — the end of a leaver's last working day on their own
 * calendar — and identity suspends: no new sign-in, every live session gone so
 * the cookie in a leaver's browser is refused on its next request, every
 * enrolment link spent, and the passkey left where it is for a rehire.
 */

const TENANT = '00000000-0000-4000-8000-00000000000a';
const OTHER_TENANT = '00000000-0000-4000-8000-00000000000b';
const ADA_IDENTITY = '00000000-0000-4000-8000-00000000000d';
const BEN_IDENTITY = '00000000-0000-4000-8000-00000000000e';
const CLEO_IDENTITY = '00000000-0000-4000-8000-00000000000f';
const ADA = '00000000-0000-4000-8000-0000000000a1'; // active, two devices
const BEN = '00000000-0000-4000-8000-0000000000a2'; // invited, never enrolled
const CLEO = '00000000-0000-4000-8000-0000000000a3'; // already suspended by an admin
const ADA_PASSKEY = '00000000-0000-4000-8000-0000000000f1';
const NOW = '2026-10-01T07:05:00.000Z';

let stop: (() => Promise<void>) | undefined;
let adminClient: ReturnType<typeof postgres> | undefined;
let serviceClient: ReturnType<typeof postgres> | undefined;
let admin: PostgresJsDatabase;
let db: PostgresJsDatabase;
let consume: ReturnType<typeof peopleConsumer>;

let ids = 0;
const newId = () => {
  ids += 1;
  return `01890000-0000-7000-8000-${String(ids).padStart(12, '0')}`;
};

beforeAll(async () => {
  const started = await startPostgres();
  stop = started.stop;
  adminClient = postgres(started.url, { max: 1 });
  admin = drizzle(adminClient);

  for (const file of [
    '20260821120000_tenant_registry.sql',
    '20260821230000_identity.sql',
    '20260822010000_enrolment_token.sql',
    '20260830100000_enrolment_token_purpose.sql',
    '20260919160000_account_name.sql',
    '20260921230000_account_mobile.sql',
    '20260923170000_identity_people_facts_at.sql',
    '20260924220100_identity_access_end.sql',
  ]) {
    const path = new URL(`../../../../../migrations/${file}`, import.meta.url);
    await admin.execute(sql.raw(await readFile(path, 'utf8')));
  }

  await admin.execute(sql`
    INSERT INTO platform.tenant (id, slug, display_name, status) VALUES
      (${TENANT}::uuid, 'acme', 'Acme', 'active'),
      (${OTHER_TENANT}::uuid, 'globex', 'Globex', 'active')
  `);
  await admin.execute(sql`
    INSERT INTO platform.identity (id) VALUES
      (${ADA_IDENTITY}::uuid), (${BEN_IDENTITY}::uuid), (${CLEO_IDENTITY}::uuid)
  `);
  await admin.execute(sql`
    INSERT INTO platform.account
      (id, tenant_id, identity_id, status, work_email, time_zone, employment_start, session_limit)
    VALUES
      (${ADA}::uuid, ${TENANT}::uuid, ${ADA_IDENTITY}::uuid, 'active',
       'ada@acme.example', 'America/Los_Angeles', '2026-01-01', 4),
      (${BEN}::uuid, ${TENANT}::uuid, ${BEN_IDENTITY}::uuid, 'invited',
       'ben@acme.example', 'America/Los_Angeles', '2026-01-01', 4),
      (${CLEO}::uuid, ${TENANT}::uuid, ${CLEO_IDENTITY}::uuid, 'suspended',
       'cleo@acme.example', 'America/Los_Angeles', '2026-01-01', 4)
  `);
  await admin.execute(sql`
    INSERT INTO platform.credential (id, identity_id, kind, external_id, provider, backed_up)
    VALUES (${ADA_PASSKEY}::uuid, ${ADA_IDENTITY}::uuid, 'passkey', 'ada-passkey', '', true)
  `);
  await admin.execute(sql`
    INSERT INTO platform.enrolment_token
      (tenant_id, account_id, token_hash, second_channel, expires_at)
    VALUES
      (${TENANT}::uuid, ${BEN}::uuid, '\\x01'::bytea, 'in_person', now() + interval '3 days'),
      (${TENANT}::uuid, ${ADA}::uuid, '\\x02'::bytea, 'in_person', now() + interval '3 days')
  `);

  await admin.execute(sql`CREATE ROLE svc_test LOGIN PASSWORD 'svc_test' NOBYPASSRLS`);
  await admin.execute(sql`GRANT USAGE ON SCHEMA platform TO svc_test`);
  await admin.execute(
    sql`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA platform TO svc_test`,
  );

  const asService = new URL(started.url);
  asService.username = 'svc_test';
  asService.password = 'svc_test';
  serviceClient = postgres(asService.toString(), { max: 4 });
  db = drizzle(serviceClient);
  consume = peopleConsumer((tenantId, fn) => withTenant(db, tenantId, fn), {
    clock: fixedClock(NOW),
    newEventId: newId,
  });
});

afterAll(async () => {
  await serviceClient?.end();
  await adminClient?.end();
  await stop?.();
});

const ctx = (): EventContext => ({
  clock: fixedClock('2026-09-30T16:00:00.000Z'),
  newEventId: newId,
  actor: { kind: 'system', process: 'test' },
  correlationId: '00000000-0000-4000-8000-0000000000c1',
  causationId: null,
});

const signIn = (accountId: string, sessionId: string) =>
  startSession({
    accounts: drizzleAccountRepository(),
    inTenantTransaction: (tenantId, fn) => withTenant(db, tenantId, fn),
  })(
    TENANT,
    accountId,
    { id: sessionId, device: { ip: '203.0.113.7', userAgent: 'test', aaguid: null }, amr: ['hwk'] },
    ctx(),
  );

const cookieCheck = authenticate({
  cache: {
    read: () => Promise.resolve(null),
    write: () => Promise.resolve(),
    forget: () => Promise.resolve(),
  },
  load: (tenantId, sessionId) => withTenant(db, tenantId, (tx) => loadSession(tx, tenantId, sessionId)),
  clock: fixedClock(NOW),
});

let n = 0;
function accessEnded(
  accountId: string | null,
  occurredAt = new Date(Date.UTC(2026, 9, 1, 7, n)).toISOString(),
) {
  n += 1;
  return {
    eventId: `01890000-0000-7000-8000-${String(900 + n).padStart(12, '0')}`,
    eventName: 'people.person.access_ended',
    eventVersion: 1,
    tenantId: TENANT,
    occurredAt,
    recordedAt: occurredAt,
    effectiveFrom: '2026-10-01',
    aggregate: { type: 'Person', id: '00000000-0000-4000-8000-0000000000e1', version: 5 },
    actor: { kind: 'system', process: 'people-lifecycle' },
    correlationId: '00000000-0000-4000-8000-0000000000c2',
    causationId: null,
    payload: {
      personId: '00000000-0000-4000-8000-0000000000e1',
      identityAccountId: accountId,
      lastWorkingDay: '2026-09-30',
      endedAt: '2026-10-01T07:00:00.000Z',
      trigger: 'last_working_day_ended',
    },
  };
}

const account = async (id: string) => {
  const [row] = await admin.execute(sql`
    SELECT status, access_ended_from FROM platform.account WHERE id = ${id}::uuid`);
  return row;
};
const liveTokens = async (id: string) =>
  [
    ...(await admin.execute(sql`
      SELECT id FROM platform.enrolment_token WHERE account_id = ${id}::uuid AND consumed_at IS NULL`)),
  ].length;
const outbox = async (id: string) =>
  [
    ...(await admin.execute(sql`
      SELECT event_name, envelope -> 'payload' AS payload FROM platform.outbox
       WHERE aggregate_id = ${id} ORDER BY event_id`)),
  ].map((r) => [r['event_name'], r['payload']]);

describe('a leaver signed in on two devices', () => {
  it('is suspended, and both cookies are refused on their next request', async () => {
    expect((await signIn(ADA, '00000000-0000-4000-8000-00000000005a')).ok).toBe(true);
    expect((await signIn(ADA, '00000000-0000-4000-8000-00000000005b')).ok).toBe(true);
    expect((await cookieCheck(TENANT, '00000000-0000-4000-8000-00000000005a')).ok).toBe(true);

    const event = accessEnded(ADA);
    expect(await consume(event)).toBe('applied');

    expect(await account(ADA)).toEqual({ status: 'suspended', access_ended_from: 'active' });
    for (const cookie of ['00000000-0000-4000-8000-00000000005a', '00000000-0000-4000-8000-00000000005b']) {
      const refused = await cookieCheck(TENANT, cookie);
      expect(!refused.ok && refused.error.code).toBe('UNAUTHENTICATED');
    }
    // No new sign-in either, on any device.
    const again = await signIn(ADA, '00000000-0000-4000-8000-00000000005c');
    expect(!again.ok && again.error.code).toBe('INVALID_TRANSITION');
    // No enrolment link left to come back through.
    expect(await liveTokens(ADA)).toBe(0);

    // The passkey is kept, unrevoked, for a rehire to sign in with.
    const [passkey] = await admin.execute(
      sql`SELECT revoked_at FROM platform.credential WHERE id = ${ADA_PASSKEY}::uuid`,
    );
    expect(passkey?.['revoked_at']).toBeNull();

    // Suspended with its own reason, each session revoked as by termination.
    const raised = (await outbox(ADA)).filter(([name]) => name !== 'identity.session.started');
    expect(raised).toEqual([
      ['identity.session.revoked', expect.objectContaining({ reason: 'terminated' })],
      ['identity.session.revoked', expect.objectContaining({ reason: 'terminated' })],
      [
        'identity.account.suspended',
        { accountId: ADA, reason: 'employment_ended', sessionsRevoked: 2 },
      ],
    ]);
  });

  it('takes the same event twice as once', async () => {
    const before = (await outbox(ADA)).length;
    const event = accessEnded(ADA);
    expect(await consume(event)).toBe('applied'); // newer than the first: claims, finds it closed
    expect(await consume(event)).toBe('unchanged');
    expect(await outbox(ADA)).toHaveLength(before);
    expect(await account(ADA)).toEqual({ status: 'suspended', access_ended_from: 'active' });
  });

  it('refuses an event older than one already applied', async () => {
    expect(await consume(accessEnded(ADA, '2026-09-01T00:00:00.000Z'))).toBe('unchanged');
  });
});

describe('the other accounts a leaver may have', () => {
  it('suspends an invited account and spends its link, so it cannot enrol on the way out', async () => {
    expect(await liveTokens(BEN)).toBe(1);
    expect(await consume(accessEnded(BEN))).toBe('applied');
    expect(await account(BEN)).toEqual({ status: 'suspended', access_ended_from: 'invited' });
    expect(await liveTokens(BEN)).toBe(0);
  });

  it('leaves an account an admin had already suspended with the admin’s reason', async () => {
    expect(await consume(accessEnded(CLEO))).toBe('applied');
    // Not marked as People's: a rehire must not lift an investigation.
    expect(await account(CLEO)).toEqual({ status: 'suspended', access_ended_from: null });
    expect(await outbox(CLEO)).toEqual([]);
  });

  it('ignores a leaver with no account, and cannot reach another tenant', async () => {
    expect(await consume(accessEnded(null))).toBe('ignored');
    const crossing = { ...accessEnded(ADA), tenantId: OTHER_TENANT };
    expect(await consume(crossing)).toBe('unchanged');
  });
});

/** People's rehire started (PEO-110): the event identity reinstates on. */
function accessRestored(accountId: string, occurredAt?: string) {
  const ended = accessEnded(accountId, occurredAt);
  return {
    ...ended,
    eventName: 'people.person.access_restored',
    effectiveFrom: '2026-11-02',
    payload: {
      personId: ended.payload.personId,
      identityAccountId: accountId,
      restoredAt: ended.occurredAt,
      reason: 'rehired',
    },
  };
}

describe('a rehire starting (PEO-110)', () => {
  it('reinstates the leaver, who signs in again with the passkey they kept', async () => {
    const event = accessRestored(ADA);
    expect(await consume(event)).toBe('applied');
    expect(await account(ADA)).toEqual({ status: 'active', access_ended_from: null });
    expect((await signIn(ADA, '00000000-0000-4000-8000-00000000005d')).ok).toBe(true);
    expect((await outbox(ADA)).at(-2)).toEqual([
      'identity.account.reinstated',
      { accountId: ADA, reinstatedBy: null },
    ]);
    // Once only.
    expect(await consume(event)).toBe('unchanged');
  });

  it('puts an invited leaver back to invited, not to an active account with no passkey', async () => {
    expect(await consume(accessRestored(BEN))).toBe('applied');
    expect(await account(BEN)).toEqual({ status: 'invited', access_ended_from: null });
  });

  it('leaves an admin’s suspension to the admin', async () => {
    expect(await consume(accessRestored(CLEO))).toBe('applied');
    expect(await account(CLEO)).toEqual({ status: 'suspended', access_ended_from: null });
  });

  it('cannot be undone by the old access_ended replayed after it', async () => {
    expect(await consume(accessEnded(ADA, '2026-10-01T07:01:00.000Z'))).toBe('unchanged');
    expect(await account(ADA)).toEqual({ status: 'active', access_ended_from: null });
  });

  it('reinstates the same way when HR corrects a notice’s last day forward (PEO-111)', async () => {
    expect(await consume(accessEnded(ADA))).toBe('applied');
    expect(await account(ADA)).toEqual({ status: 'suspended', access_ended_from: 'active' });
    const corrected = accessRestored(ADA);
    corrected.payload.reason = 'last_working_day_corrected';
    expect(await consume(corrected)).toBe('applied');
    expect(await account(ADA)).toEqual({ status: 'active', access_ended_from: null });
  });
});
