import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { Redis } from 'ioredis';
import { readFile } from 'node:fs/promises';
import { fixedClock, ok, systemClock, type Result } from '@kithena/domain-kit';
import { startPostgres, startValkey } from '@kithena/testing';

import { Account } from '../account/domain/account.js';
import { drizzleAccountRepository } from '../account/infrastructure/drizzle-account-repository.js';
import { completeEnrolment } from './application/complete-enrolment.js';
import { drizzleEnrolmentTokenStore } from './infrastructure/drizzle-enrolment-token-store.js';
import { simpleWebAuthnRelyingParty } from '../credential/infrastructure/simplewebauthn-relying-party.js';
import { valkeyChallengeStore } from '../credential/infrastructure/valkey-challenge-store.js';
import { softwareAuthenticator } from '../credential/testing/software-authenticator.js';
import { uuidv7 } from '../shared/uuid.js';

/**
 * A first passkey, created and then used.
 *
 * The other integration test proves an assertion against a credential inserted
 * by hand. This one proves the credential can be *made* — a real attestation
 * object, verified by the real library, stored, and then signed in with. The
 * two together mean nothing on this path rests on a fixture.
 */

const RP_ID = 'app.kithena.com';
const ORIGIN = 'https://acme.app.kithena.com';
const TENANT = '00000000-0000-4000-8000-00000000000a';
const IDENTITY = '00000000-0000-4000-8000-00000000000d';
const ACCOUNT = '00000000-0000-4000-8000-0000000000a1';

let stopPg: (() => Promise<void>) | undefined;
let stopValkey: (() => Promise<void>) | undefined;
let adminClient: ReturnType<typeof postgres> | undefined;
let serviceClient: ReturnType<typeof postgres> | undefined;
let valkey: Redis | undefined;
let admin: PostgresJsDatabase;
let db: PostgresJsDatabase;

beforeAll(async () => {
  const [pg, cache] = await Promise.all([startPostgres(), startValkey()]);
  stopPg = pg.stop;
  stopValkey = cache.stop;
  valkey = new Redis(cache.url);

  adminClient = postgres(pg.url, { max: 1 });
  admin = drizzle(adminClient);

  for (const file of [
    '20260821120000_tenant_registry.sql',
    '20260821230000_identity.sql',
    '20260822010000_enrolment_token.sql',
    // Adds `purpose`, which `issue` writes and `inspect` reads. Listed because
    // this suite names the migrations it needs: leaving it out fails on the
    // insert, which reads like a bug in the store rather than a missing column.
    '20260830100000_enrolment_token_purpose.sql',
    // The name columns, which completing an enrolment writes.
    '20260919160000_account_name.sql',
    // And the number beside them, written by the same step.
    '20260921230000_account_mobile.sql',
  ]) {
    const path = new URL(`../../../../migrations/${file}`, import.meta.url);
    await admin.execute(sql.raw(await readFile(path, 'utf8')));
  }

  await admin.execute(sql`
    INSERT INTO platform.tenant (id, slug, display_name, status)
    VALUES (${TENANT}::uuid, 'acme', 'Acme', 'active')
  `);
  await admin.execute(sql`INSERT INTO platform.identity (id) VALUES (${IDENTITY}::uuid)`);

  await admin.execute(sql`CREATE ROLE svc_test LOGIN PASSWORD 'svc_test' NOBYPASSRLS`);
  await admin.execute(sql`GRANT USAGE ON SCHEMA platform TO svc_test`);
  await admin.execute(
    sql`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA platform TO svc_test`,
  );

  const asService = new URL(pg.url);
  asService.username = 'svc_test';
  asService.password = 'svc_test';
  serviceClient = postgres(asService.toString(), { max: 8 });
  db = drizzle(serviceClient);
});

afterAll(async () => {
  valkey?.disconnect();
  await serviceClient?.end();
  await adminClient?.end();
  await Promise.all([stopPg?.(), stopValkey?.()]);
});

function inTenant<T>(fn: (tx: PostgresJsDatabase) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.tenant_id', ${TENANT}, true)`);
    return fn(tx);
  });
}

/** Put the account back in the state HR leaves it in: invited, not yet enrolled. */
async function invitedAccount(employmentStart = '2026-01-01'): Promise<void> {
  await admin.execute(sql`DELETE FROM platform.session`);
  await admin.execute(sql`DELETE FROM platform.enrolment_token`);
  await admin.execute(sql`DELETE FROM platform.credential`);
  await admin.execute(sql`DELETE FROM platform.account`);
  await admin.execute(sql`
    INSERT INTO platform.account
      (id, tenant_id, identity_id, status, work_email, time_zone, employment_start)
    VALUES (${ACCOUNT}::uuid, ${TENANT}::uuid, ${IDENTITY}::uuid, 'invited',
            'ada@acme.example', 'Europe/Madrid', ${employmentStart}::date)
  `);
}

const rp = simpleWebAuthnRelyingParty({ rpId: RP_ID, rpName: 'Kithena' });

/** Run enrolment the way the route would, and report what it did. */
async function enrol(
  authenticator: ReturnType<typeof softwareAuthenticator>,
  options: {
    token?: string;
    clockAt?: string;
    origin?: string;
    profile?: { timeZone: string; mobile: string | null };
  } = {},
): Promise<{ result: Result<{ accountId: string; credentialId: string }>; refusals: string[] }> {
  const refusals: string[] = [];

  return inTenant(async (tx) => {
    const tokens = drizzleEnrolmentTokenStore(tx, TENANT);
    const token =
      options.token ??
      (await tokens.issue({ accountId: ACCOUNT, purpose: 'invitation', secondChannel: 'in_person', issuedBy: null }))
        .token;

    const { challenge } = await rp.beginRegistration({
      identityId: IDENTITY,
      displayName: 'ada@acme.example',
      excludeCredentialIds: [],
      requireHardwareBound: false,
    });
    const challenges = valkeyChallengeStore(valkey as never);
    await challenges.issue(challenge, { purpose: 'registration', subject: IDENTITY }, 300);

    const origin = options.origin ?? ORIGIN;
    const response = authenticator.register({ challenge, origin, rpId: RP_ID });

    const result = await completeEnrolment({
      tokens,
      verifyRegistration: (r, expected) => rp.finishRegistration(r, expected),
      identityOf: async (accountId) => {
        const rows = await tx.execute(
          sql`SELECT identity_id FROM platform.account WHERE id = ${accountId}::uuid`,
        );
        return [...rows][0]?.['identity_id'] === undefined
          ? null
          : String([...rows][0]?.['identity_id']);
      },
      // Written to the same transaction the rest of enrolment uses, so a test
      // asserting the account afterwards sees what a real enrolment would have
      // left behind.
      recordName: async (accountId, name) => {
        await tx.execute(sql`
          UPDATE platform.account
             SET given_name = ${name.given},
                 family_name = ${name.family},
                 preferred_name = ${name.preferred}
           WHERE id = ${accountId}::uuid
        `);
      },
      recordProfile: async (accountId, profile) => {
        await tx.execute(sql`
          UPDATE platform.account
             SET time_zone = ${profile.timeZone},
                 mobile = ${profile.mobile}
           WHERE id = ${accountId}::uuid
        `);
      },
      storeCredential: async (identityId, credential) => {
        const id = uuidv7();
        await tx.execute(sql`
          INSERT INTO platform.credential
            (id, identity_id, kind, external_id, provider, public_key, sign_count, backed_up)
          VALUES (${id}::uuid, ${identityId}::uuid, 'passkey', ${credential.credentialId},
                  ${credential.aaguid}, ${Buffer.from(credential.publicKey)},
                  ${credential.signCount}, ${credential.backedUp})
        `);
        return id;
      },
      enrolAccount: async (accountId, credentialId) => {
        const accounts = drizzleAccountRepository();
        const snapshot = await accounts.load(tx, accountId);
        if (!snapshot) throw new Error('account vanished');
        const account = Account.rehydrate(snapshot);
        const enrolled = account.enrol(credentialId, {
          clock: options.clockAt === undefined ? systemClock : fixedClock(options.clockAt),
          newEventId: () => uuidv7(),
          actor: { kind: 'system', process: 'integration-test' },
          correlationId: '00000000-0000-4000-8000-0000000000c1',
          causationId: null,
        });
        if (!enrolled.ok) return enrolled;
        await accounts.save(tx, account);
        return ok(undefined);
      },
      origins: { rpId: RP_ID, authOrigin: 'https://auth.app.kithena.com' },
      clock: systemClock,
      onRefusal: (reason) => refusals.push(reason),
    })({
      tenantId: TENANT,
      token,
      response,
      origin,
      challenge,
      ...(options.profile === undefined ? {} : { profile: options.profile }),
    });

    return { result, refusals };
  });
}

async function statusOfAccount(): Promise<string> {
  const rows = await admin.execute(
    sql`SELECT status FROM platform.account WHERE id = ${ACCOUNT}::uuid`,
  );
  return String([...rows][0]?.['status']);
}

describe('a first passkey', () => {
  it('registers, stores a credential, and activates the account', async () => {
    await invitedAccount();
    const { result, refusals } = await enrol(softwareAuthenticator('new-passkey'));

    expect(refusals).toEqual([]);
    expect(result.ok).toBe(true);

    expect(await statusOfAccount()).toBe('active');
    const credentials = await admin.execute(sql`SELECT external_id FROM platform.credential`);
    expect([...credentials]).toHaveLength(1);
  });

  it('spends the link, so the same one cannot enrol a second authenticator', async () => {
    // The stolen-link case. A link that has been used is gone, whether or not
    // whoever used it was supposed to.
    await invitedAccount();
    const issued = await inTenant((tx) =>
      drizzleEnrolmentTokenStore(tx, TENANT).issue({
        accountId: ACCOUNT,
        purpose: 'invitation', secondChannel: 'in_person',
        issuedBy: null,
      }),
    );

    const first = await enrol(softwareAuthenticator('first'), { token: issued.token });
    const second = await enrol(softwareAuthenticator('second'), { token: issued.token });

    expect(first.result.ok).toBe(true);
    expect(second.result.ok).toBe(false);
    expect(second.refusals).toContain('token');
  });

  it('refuses a link presented from an origin nobody issued', async () => {
    await invitedAccount();
    const { result, refusals } = await enrol(softwareAuthenticator('elsewhere'), {
      origin: 'https://acme.app.kithena.com.evil.com',
    });

    expect(result.ok).toBe(false);
    expect(refusals).toEqual(['origin']);
    // And the token was never spent, because the origin is checked first.
    const live = await admin.execute(
      sql`SELECT count(*)::int AS n FROM platform.enrolment_token WHERE consumed_at IS NULL`,
    );
    expect(Number([...live][0]?.['n'])).toBe(1);
  });

  it('refuses to activate an account whose employment has not started', async () => {
    // A hire entered three weeks early has an invited account and, now, a valid
    // passkey. Those three weeks are still not employment.
    await invitedAccount('2026-06-01');
    const { result, refusals } = await enrol(softwareAuthenticator('early'), {
      clockAt: '2026-05-01T09:00:00.000Z',
    });

    expect(result.ok).toBe(false);
    expect(refusals).toContain('EMPLOYMENT_NOT_STARTED');
    expect(await statusOfAccount()).toBe('invited');
  });
});

describe('re-issuing a link', () => {
  it('invalidates the one before it', async () => {
    // Somebody who asked three times has one usable link, not three. The two
    // they did not use are two more chances for someone else.
    await invitedAccount();

    const [first, second] = await inTenant(async (tx) => {
      const store = drizzleEnrolmentTokenStore(tx, TENANT);
      const a = await store.issue({
        accountId: ACCOUNT,
        purpose: 'invitation', secondChannel: 'in_person',
        issuedBy: null,
      });
      const b = await store.issue({
        accountId: ACCOUNT,
        purpose: 'invitation', secondChannel: 'in_person',
        issuedBy: null,
      });
      return [a.token, b.token];
    });

    const stale = await enrol(softwareAuthenticator('stale'), { token: first });
    expect(stale.result.ok).toBe(false);

    const current = await enrol(softwareAuthenticator('current'), { token: second });
    expect(current.result.ok).toBe(true);
  });

  it('stores a hash, never the token', async () => {
    // A backup, a replica or a support query must not yield anything usable.
    await invitedAccount();
    const issued = await inTenant((tx) =>
      drizzleEnrolmentTokenStore(tx, TENANT).issue({
        accountId: ACCOUNT,
        purpose: 'invitation', secondChannel: 'in_person',
        issuedBy: null,
      }),
    );

    const rows = await admin.execute(sql`SELECT token_hash FROM platform.enrolment_token`);
    const stored = [...rows][0]?.['token_hash'];
    expect(String(stored)).not.toContain(issued.token);
    expect(Buffer.from(stored as Uint8Array)).toHaveLength(32);
  });
});

describe('what onboarding collects', () => {
  /**
   * The zone is the whole reason this is asked at enrolment.
   *
   * Every invitation path writes `Etc/UTC` when HR types nothing —
   * `checkEmployment` defaults it there, and so does the first-administrator
   * path — so a clock rendered from the account said UTC for everybody. The
   * person enrolling is in front of the one device that knows the answer.
   */
  it('writes the zone and the number the person confirmed', async () => {
    await invitedAccount();
    // The state every invitation path leaves behind, set explicitly rather
    // than assumed: `invitedAccount` reuses one row across this file, so a
    // test that trusted the previous one's leftovers would pass or fail on
    // the order they happen to run in.
    await admin.execute(sql`
      UPDATE platform.account
         SET time_zone = 'Etc/UTC', mobile = NULL
       WHERE id = ${ACCOUNT}::uuid
    `);

    const { result } = await enrol(softwareAuthenticator('new-passkey'), {
      profile: { timeZone: 'Europe/Madrid', mobile: '+34 600 123 456' },
    });

    expect(result.ok).toBe(true);
    expect(await profileOfAccount()).toEqual({
      timeZone: 'Europe/Madrid',
      mobile: '+34 600 123 456',
    });
  });

  /**
   * A recovery link never shows the form, so the page sends no profile — and
   * this is what makes that safe. Writing the draft anyway would move a
   * returning employee to wherever they happened to be sitting and delete the
   * number their HR team had just used to verify them.
   */
  it('leaves both columns alone when no profile is sent', async () => {
    await invitedAccount();
    await admin.execute(sql`
      UPDATE platform.account
         SET time_zone = 'Europe/Berlin', mobile = '+49 151 1234567'
       WHERE id = ${ACCOUNT}::uuid
    `);

    const { result } = await enrol(softwareAuthenticator('new-passkey'));

    expect(result.ok).toBe(true);
    expect(await profileOfAccount()).toEqual({
      timeZone: 'Europe/Berlin',
      mobile: '+49 151 1234567',
    });
  });
});

async function profileOfAccount(): Promise<{ timeZone: string; mobile: string | null }> {
  const rows = await admin.execute(
    sql`SELECT time_zone, mobile FROM platform.account WHERE id = ${ACCOUNT}::uuid`,
  );
  const row = [...rows][0];
  return {
    timeZone: String(row?.['time_zone']),
    mobile: typeof row?.['mobile'] === 'string' ? row['mobile'] : null,
  };
}
