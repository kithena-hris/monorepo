import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { Redis } from 'ioredis';
import { readFile } from 'node:fs/promises';
import { ok, systemClock } from '@kithena/domain-kit';
import { startPostgres, startValkey } from '@kithena/testing';

import { startSession } from '../account/application/start-session.js';
import {
  drizzleAccountRepository,
} from '../account/infrastructure/drizzle-account-repository.js';
import { uuidv7 } from '../shared/uuid.js';
import { signIn } from './application/sign-in.js';
import { signInWithPasskey } from './application/sign-in-with-passkey.js';
import { defaultCredentialPolicy } from './domain/credential.js';
import { challengeFrom } from './domain/client-data.js';
import { drizzleCredentialRepository } from './infrastructure/drizzle-credential-repository.js';
import { simpleWebAuthnRelyingParty } from './infrastructure/simplewebauthn-relying-party.js';
import { valkeyChallengeStore } from './infrastructure/valkey-challenge-store.js';
import { softwareAuthenticator } from './testing/software-authenticator.js';

/**
 * A real assertion, verified by the real library, against a real database.
 *
 * Everything else in this slice stubs the cryptography and tests the rules
 * around it. This test signs actual authenticator data with an actual P-256
 * key and drives the whole path: origin, challenge, signature, clone
 * detection, the account lookup, and a session row at the end.
 *
 * It is the difference between "sign-in is wired up" and "sign-in works".
 */

const RP_ID = 'app.kithena.com';
const ORIGIN = 'https://acme.app.kithena.com';
const TENANT = '00000000-0000-4000-8000-00000000000a';
const OTHER_TENANT = '00000000-0000-4000-8000-00000000000b';
const IDENTITY = '00000000-0000-4000-8000-00000000000d';
const ACCOUNT = '00000000-0000-4000-8000-0000000000a1';
const CREDENTIAL = '00000000-0000-4000-8000-0000000000f1';

let stopPg: (() => Promise<void>) | undefined;
let stopValkey: (() => Promise<void>) | undefined;
let adminClient: ReturnType<typeof postgres> | undefined;
let serviceClient: ReturnType<typeof postgres> | undefined;
let valkey: Redis | undefined;
let admin: PostgresJsDatabase;
let db: PostgresJsDatabase;

const authenticator = softwareAuthenticator('acme-passkey');

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
    // Signing in without a tenant in the URL asks which companies a person may
    // sign into, which is a cross-tenant question and therefore a SECURITY
    // DEFINER function rather than a query. Listed here because this suite
    // names the migrations it needs: leaving it out fails as
    // `42883 No function matches`, which reads like a typo in the query.
    '20260829090000_accounts_for_identity.sql',
  ]) {
    const path = new URL(`../../../../migrations/${file}`, import.meta.url);
    await admin.execute(sql.raw(await readFile(path, 'utf8')));
  }

  await admin.execute(sql`
    INSERT INTO platform.tenant (id, slug, display_name, status) VALUES
      (${TENANT}::uuid, 'acme', 'Acme', 'active'),
      (${OTHER_TENANT}::uuid, 'globex', 'Globex', 'active')
  `);
  await admin.execute(sql`INSERT INTO platform.identity (id) VALUES (${IDENTITY}::uuid)`);
  await admin.execute(sql`
    INSERT INTO platform.account
      (id, tenant_id, identity_id, status, work_email, time_zone, employment_start)
    VALUES (${ACCOUNT}::uuid, ${TENANT}::uuid, ${IDENTITY}::uuid, 'active',
            'ada@acme.example', 'Europe/Madrid', '2026-01-01')
  `);
  await admin.execute(sql`
    INSERT INTO platform.credential
      (id, identity_id, kind, external_id, provider, public_key, sign_count, backed_up)
    VALUES (${CREDENTIAL}::uuid, ${IDENTITY}::uuid, 'passkey',
            ${authenticator.credentialId}, '', ${Buffer.from(authenticator.cosePublicKey)},
            0, true)
  `);

  await admin.execute(sql`CREATE ROLE svc_test LOGIN PASSWORD 'svc_test' NOBYPASSRLS`);
  await admin.execute(sql`GRANT USAGE ON SCHEMA platform TO svc_test`);
  await admin.execute(
    sql`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA platform TO svc_test`,
  );
  /*
   * Functions too, and this role needs them now.
   *
   * `accounts_for_identity` is SECURITY DEFINER and revokes EXECUTE from
   * PUBLIC, so a service role that was only granted tables gets `42501
   * permission denied` — which looks like a row-level security refusal and is
   * not one. `svc_test` stands in for `svc_identity` here, and the real role is
   * granted the same thing by the migration.
   */
  await admin.execute(sql`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA platform TO svc_test`);

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

function inTenantTransaction<T>(tenantId: string, fn: (tx: PostgresJsDatabase) => Promise<T>) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx);
  });
}

function subject(refusals: string[] = []) {
  const rp = simpleWebAuthnRelyingParty({ rpId: RP_ID, rpName: 'Kithena' });
  const challenges = valkeyChallengeStore(valkey as never);
  const begin = startSession({ accounts: drizzleAccountRepository(), inTenantTransaction });

  const run = signIn({
    verify: signInWithPasskey({
      rp,
      challenges,
      credentials: drizzleCredentialRepository(db),
      origins: { rpId: RP_ID, authOrigin: 'https://auth.app.kithena.com' },
      policyFor: () => Promise.resolve(defaultCredentialPolicy),
      onRefusal: (reason) => refusals.push(reason),
    }),
    // The same cross-tenant lookup the service uses. Exercised here rather
    // than stubbed, because the SECURITY DEFINER function is the half that
    // row-level security would otherwise silently return nothing from.
    accountsFor: async (identityId) => {
      const rows = await db.execute(sql`
        SELECT account_id, tenant_id, tenant_slug, work_email
          FROM platform.accounts_for_identity(${identityId}::uuid)
      `);
      return [...rows].map((row) => ({
        accountId: String(row['account_id']),
        tenantId: String(row['tenant_id']),
        tenantSlug: String(row['tenant_slug']),
        workEmail: String(row['work_email']),
      }));
    },
    beginSession: async (tenantId, accountId, device, amr) => {
      const sessionId = uuidv7();
      const result = await begin(
        tenantId,
        accountId,
        { id: sessionId, device, amr },
        {
          clock: systemClock,
          newEventId: () => uuidv7(),
          actor: { kind: 'user', userId: accountId },
          correlationId: '00000000-0000-4000-8000-0000000000c1',
          causationId: null,
        },
      );
      if (!result.ok) return result;
      return ok({ sessionId, accountId, expiresAt: '2026-12-01T00:00:00.000Z' });
    },
    onRefusal: (reason) => refusals.push(reason),
  });

  return { rp, challenges, run };
}

const device = { ip: '203.0.113.7', userAgent: 'integration', aaguid: null };

/** Begin a ceremony the way the route does, then answer it. */
async function ceremony(over: Partial<Parameters<typeof authenticator.assert>[0]> = {}) {
  const { rp, challenges } = subject();
  const { challenge } = await rp.beginAuthentication();
  await challenges.issue(challenge, { purpose: 'authentication', subject: null }, 300);

  return authenticator.assert({ challenge, origin: ORIGIN, rpId: RP_ID, ...over });
}

async function resetCredential(signCount = 0): Promise<void> {
  await admin.execute(
    sql`UPDATE platform.credential SET sign_count = ${signCount}, revoked_at = NULL WHERE id = ${CREDENTIAL}::uuid`,
  );
  await admin.execute(sql`DELETE FROM platform.session`);
}

describe('a real passkey signs in', () => {
  it('verifies the assertion and starts a session', async () => {
    await resetCredential();
    const refusals: string[] = [];
    const { run } = subject(refusals);
    const assertion = await ceremony({ signCount: 1 });

    const result = await run({
      tenantId: TENANT,
      response: assertion,
      origin: ORIGIN,
      challenge: challengeFrom(assertion) ?? '',
      device,
    });

    expect(refusals).toEqual([]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.accountId).toBe(ACCOUNT);

    const rows = await inTenantTransaction(TENANT, (tx) =>
      tx.execute(sql`SELECT slot FROM platform.session WHERE account_id = ${ACCOUNT}::uuid`),
    );
    expect([...rows]).toHaveLength(1);
  });

  it('advances the stored counter, so the next clone is detectable', async () => {
    await resetCredential();
    const { run } = subject();
    const assertion = await ceremony({ signCount: 7 });

    await run({
      tenantId: TENANT,
      response: assertion,
      origin: ORIGIN,
      challenge: challengeFrom(assertion) ?? '',
      device,
    });

    const rows = await admin.execute(
      sql`SELECT sign_count FROM platform.credential WHERE id = ${CREDENTIAL}::uuid`,
    );
    expect(Number([...rows][0]?.['sign_count'])).toBe(7);
  });
});

describe('and the ways it must not', () => {
  it('refuses a replayed assertion', async () => {
    // The captured-assertion attack, end to end. The signature verifies
    // perfectly the second time; the spent challenge is what stops it.
    await resetCredential();
    const refusals: string[] = [];
    const { run } = subject(refusals);
    const assertion = await ceremony({ signCount: 3 });
    const request = {
      tenantId: TENANT,
      response: assertion,
      origin: ORIGIN,
      challenge: challengeFrom(assertion) ?? '',
      device,
    };

    expect((await run(request)).ok).toBe(true);
    expect((await run(request)).ok).toBe(false);
    expect(refusals).toContain('challenge');
  });

  it('refuses an assertion for an origin nobody issued', async () => {
    await resetCredential();
    const refusals: string[] = [];
    const { run } = subject(refusals);
    const assertion = await ceremony({ origin: 'https://acme.app.kithena.com.evil.com' });

    const result = await run({
      tenantId: TENANT,
      response: assertion,
      origin: 'https://acme.app.kithena.com.evil.com',
      challenge: challengeFrom(assertion) ?? '',
      device,
    });

    expect(result.ok).toBe(false);
    expect(refusals).toContain('origin');
  });

  it('refuses an assertion that only proves presence', async () => {
    // The authenticator signs without setting the user-verified flag. The
    // signature is valid; the assertion proves possession of an unlocked
    // device and nothing about who was holding it.
    await resetCredential();
    const refusals: string[] = [];
    const { run } = subject(refusals);
    const assertion = await ceremony({ userVerified: false, signCount: 2 });

    const result = await run({
      tenantId: TENANT,
      response: assertion,
      origin: ORIGIN,
      challenge: challengeFrom(assertion) ?? '',
      device,
    });

    expect(result.ok).toBe(false);
    expect(refusals).toContain('credential');
  });

  it('refuses a counter that went backwards', async () => {
    // A cloned authenticator: same key, stale counter.
    await resetCredential(9);
    const refusals: string[] = [];
    const { run } = subject(refusals);
    const assertion = await ceremony({ signCount: 4 });

    const result = await run({
      tenantId: TENANT,
      response: assertion,
      origin: ORIGIN,
      challenge: challengeFrom(assertion) ?? '',
      device,
    });

    expect(result.ok).toBe(false);
  });

  it('refuses a revoked passkey', async () => {
    await resetCredential();
    await admin.execute(
      sql`UPDATE platform.credential SET revoked_at = now() WHERE id = ${CREDENTIAL}::uuid`,
    );
    const { run } = subject();
    const assertion = await ceremony({ signCount: 5 });

    const result = await run({
      tenantId: TENANT,
      response: assertion,
      origin: ORIGIN,
      challenge: challengeFrom(assertion) ?? '',
      device,
    });

    expect(result.ok).toBe(false);
    await admin.execute(
      sql`UPDATE platform.credential SET revoked_at = NULL WHERE id = ${CREDENTIAL}::uuid`,
    );
  });

  it('refuses a valid passkey at a company that never hired them', async () => {
    // Commissioning, proven rather than asserted. The same passkey that just
    // worked at Acme is refused at Globex, because there is no account there —
    // and the refusal is indistinguishable from a bad passkey.
    await resetCredential();
    const refusals: string[] = [];
    const { run } = subject(refusals);
    // Signed *for* Globex's origin, not merely presented there. Signing for
    // Acme and claiming Globex is refused one step earlier, by the signature
    // check, which would have made this test pass for the wrong reason.
    const assertion = await ceremony({
      signCount: 6,
      origin: 'https://globex.app.kithena.com',
    });

    const result = await run({
      tenantId: OTHER_TENANT,
      response: assertion,
      origin: 'https://globex.app.kithena.com',
      challenge: challengeFrom(assertion) ?? '',
      device,
    });

    expect(result.ok).toBe(false);
    expect(refusals).toContain('no-account');
  });
});
