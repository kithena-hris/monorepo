import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { Redis } from 'ioredis';
import { ok, systemClock } from '@kithena/domain-kit';
import { logger } from '@kithena/telemetry';

import { startSession } from './account/application/start-session.js';
import {
  drizzleAccountRepository,
  findActiveAccountForIdentity,
} from './account/infrastructure/drizzle-account-repository.js';
import { Account } from './account/domain/account.js';
import { defaultCredentialPolicy } from './credential/domain/credential.js';
import { signInWithPasskey } from './credential/application/sign-in-with-passkey.js';
import { signIn } from './credential/application/sign-in.js';
import { drizzleCredentialRepository } from './credential/infrastructure/drizzle-credential-repository.js';
import { simpleWebAuthnRelyingParty } from './credential/infrastructure/simplewebauthn-relying-party.js';
import { valkeyChallengeStore } from './credential/infrastructure/valkey-challenge-store.js';
import { webauthnRoutes } from './credential/http/webauthn-routes.js';
import { completeEnrolment } from './credential/application/complete-enrolment.js';
import { drizzleEnrolmentTokenStore } from './credential/infrastructure/drizzle-enrolment-token-store.js';
import { enrolmentRoutes } from './credential/http/enrolment-routes.js';
import { resolveTenant } from './tenancy/application/resolve-tenant.js';
import { drizzleTenantRepository } from './tenancy/infrastructure/drizzle-tenant-repository.js';
import { tenantRoutes } from './tenancy/http/tenant-routes.js';
import { jwksRoute } from './token/http/jwks-route.js';
import { developmentKey, joseSigner } from './token/infrastructure/jose-signer.js';
import { uuidv7 } from './shared/uuid.js';
import { operatorSignIn } from './operator/application/operator-sign-in.js';
import { drizzleOperatorRepository } from './operator/infrastructure/drizzle-operator-repository.js';
import { operatorRoutes } from './operator/http/operator-routes.js';
import { provisionTenant } from './tenancy/application/provision-tenant.js';
import { adminRoutes } from './tenancy/http/admin-routes.js';

/**
 * Where the slices are joined.
 *
 * This is the only file allowed to know about more than one of them, which is
 * why the wiring lives here rather than inside a use case:
 * `no-cross-slice-imports` refuses the alternative, and correctly. Each slice
 * declares the operations it needs and this supplies them.
 *
 * Split out of `main.ts` when that file reached two hundred lines and had
 * stopped being a bootstrap. `main.ts` now starts a server; this decides what
 * the server is.
 */
export interface Config {
  readonly databaseUrl: string;
  /**
   * The back-office's relying party, which is deliberately not the product's.
   *
   * `admin.kithena.com` is not under `app.kithena.com`, so a browser will not
   * offer an employee's passkey to the back-office and will not offer an
   * operator's to the product. That isolation costs nothing and is the main
   * reason the back-office lives on its own registrable domain.
   */
  readonly adminRpId: string;
  readonly adminOrigin: string;
  readonly valkeyUrl: string;
  readonly internalToken: string;
  readonly rpId: string;
  readonly authOrigin: string;
  readonly signingKey: string | undefined;
  readonly allowInsecureOrigins: boolean;
}

export type RequestHandler = (
  request: IncomingMessage,
  response: ServerResponse,
) => Promise<boolean>;

export async function compose(config: Config): Promise<RequestHandler> {
  const db = drizzle(postgres(config.databaseUrl));
  const valkey = new Redis(config.valkeyUrl);

  const signer = await joseSigner(
    config.signingKey === undefined
      ? await developmentKey()
      : (JSON.parse(config.signingKey) as never),
  );

  const relyingParty = simpleWebAuthnRelyingParty({ rpId: config.rpId, rpName: 'Kithena' });
  const challenges = valkeyChallengeStore(valkey);
  const origins = {
    rpId: config.rpId,
    authOrigin: config.authOrigin,
    allowInsecure: config.allowInsecureOrigins,
  };

  const inTenantTransaction = <T>(
    tenantId: string,
    fn: (tx: PostgresJsDatabase) => Promise<T>,
  ): Promise<T> =>
    db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
      return fn(tx);
    });

  const accounts = drizzleAccountRepository();
  const begin = startSession({ accounts, inTenantTransaction });

  const context = (actorId: string) => ({
    clock: systemClock,
    newEventId: () => uuidv7(),
    actor: { kind: 'user' as const, userId: actorId },
    correlationId: randomUUID(),
    causationId: null,
  });

  const jwks = jwksRoute(signer);

  const tenants = tenantRoutes({
    resolve: resolveTenant({ tenants: drizzleTenantRepository(db) }),
    internalToken: config.internalToken,
  });

  const webauthn = webauthnRoutes({
    rp: relyingParty,
    challenges,
    internalToken: config.internalToken,
    onRefusal: (reason, detail) => {
      logger.info({ reason, ...detail }, 'sign-in refused');
    },
    signIn: signIn({
      verify: signInWithPasskey({
        rp: relyingParty,
        challenges,
        credentials: drizzleCredentialRepository(db),
        origins,
        // Per-tenant authenticator policy lands with the auth settings screen.
        // Until then every tenant gets the floor: user verification required,
        // synced passkeys accepted.
        policyFor: () => Promise.resolve(defaultCredentialPolicy),
        onRefusal: (reason) => {
          logger.info({ reason }, 'passkey refused');
        },
      }),
      activeAccountFor: (tenantId, identityId) =>
        inTenantTransaction(tenantId, (tx) => findActiveAccountForIdentity(tx, identityId)),
      beginSession: async (tenantId, accountId, device, amr) => {
        const sessionId = uuidv7();
        const started = await begin(
          tenantId,
          accountId,
          { id: sessionId, device, amr },
          context(accountId),
        );
        if (!started.ok) return started;

        return ok({
          sessionId,
          accountId,
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        });
      },
      onRefusal: (reason) => {
        logger.info({ reason }, 'sign-in refused');
      },
    }),
  });

  const enrolment = enrolmentRoutes({
    rp: relyingParty,
    challenges,
    internalToken: config.internalToken,
    /*
     * Enrolment runs inside one tenant-scoped transaction from end to end.
     *
     * Spending the link, writing the credential and activating the account
     * commit together or not at all. Half of that is an account that cannot log
     * in holding a link that has been spent — a new hire locked out on their
     * first morning, with nothing obviously broken to point at.
     */
    complete: (request) =>
      inTenantTransaction(request.tenantId, (tx) =>
        completeEnrolment({
          tokens: drizzleEnrolmentTokenStore(tx, request.tenantId),
          verifyRegistration: (response, expected) =>
            relyingParty.finishRegistration(response, expected),
          identityOf: async (accountId) => {
            const rows = await tx.execute(
              sql`SELECT identity_id FROM platform.account WHERE id = ${accountId}::uuid`,
            );
            // Narrowed rather than stringified. `String(unknown)` on a row
            // value renders an object as "[object Object]" and hands that on as
            // if it were an identity id — a lookup that then finds nothing, for
            // a reason no log would explain.
            const value = [...rows][0]?.['identity_id'];
            return typeof value === 'string' ? value : null;
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
            const snapshot = await accounts.load(tx, accountId);
            if (!snapshot) throw new Error('account vanished mid-enrolment');
            const account = Account.rehydrate(snapshot);
            const enrolled = account.enrol(credentialId, context(accountId));
            if (!enrolled.ok) return enrolled;
            await accounts.save(tx, account);
            return ok(undefined);
          },
          origins,
          clock: systemClock,
          onRefusal: (reason) => {
            logger.info({ reason }, 'enrolment refused');
          },
        })(request),
      ),
  });

  /* ------------------------------------------------------------ back-office */

  const operators = drizzleOperatorRepository(db);
  const adminRelyingParty = simpleWebAuthnRelyingParty({
    rpId: config.adminRpId,
    rpName: 'Kithena back-office',
  });
  const adminOrigins = {
    rpId: config.adminRpId,
    authOrigin: config.adminOrigin,
    allowInsecure: config.allowInsecureOrigins,
  };

  const operator = operatorRoutes({
    operators,
    internalToken: config.internalToken,
    clock: systemClock,
    beginAssertion: () => adminRelyingParty.beginAuthentication(),
    beginRegistration: (input) =>
      adminRelyingParty.beginRegistration({
        identityId: input.identityId,
        displayName: input.displayName,
        excludeCredentialIds: [],
        // The back-office is where hardware-bound authenticators would be
        // demanded if anywhere. Left off until there is a second operator to
        // inconvenience; the policy is recorded in auth-administration.md.
        requireHardwareBound: false,
      }),
    finishRegistration: async (response, expected) => {
      const verified = await adminRelyingParty.finishRegistration(response, expected);
      await db.execute(sql`
        INSERT INTO platform.credential
          (id, identity_id, kind, external_id, provider, public_key, sign_count, backed_up)
        VALUES (${uuidv7()}::uuid, ${expected.identityId}::uuid, 'passkey',
                ${verified.credentialId}, ${verified.aaguid},
                ${Buffer.from(verified.publicKey)}, ${verified.signCount}, ${verified.backedUp})
      `);
    },
    rememberChallenge: (challenge, purpose, subject) =>
      challenges.issue(challenge, { purpose, subject }, 300),
    spendChallenge: (challenge) => challenges.consume(challenge),
    onRefusal: (reason) => {
      logger.info({ reason }, 'operator refused');
    },
    signIn: operatorSignIn({
      clock: systemClock,
      verify: async (request) => {
        const verified = await signInWithPasskey({
          rp: adminRelyingParty,
          challenges: {
            // The challenge was already spent by the route, so this sees a
            // ceremony that has been admitted once and must not be admitted
            // again by a second consume.
            issue: () => Promise.resolve(),
            consume: () => Promise.resolve({ purpose: 'authentication', subject: null }),
          },
          credentials: drizzleCredentialRepository(db),
          origins: adminOrigins,
          policyFor: () => Promise.resolve(defaultCredentialPolicy),
          onRefusal: (reason) => {
            logger.info({ reason }, 'operator passkey refused');
          },
        })(request);

        return verified.ok ? ok({ identityId: verified.value.identityId }) : verified;
      },
      findOperator: (identityId) => operators.byIdentity(identityId),
      startSession: async (operatorId, expiresAt) => {
        const id = uuidv7();
        await operators.startSession({ id, operatorId, expiresAt, ip: null, userAgent: null });
        return id;
      },
      onRefusal: (reason) => {
        logger.info({ reason }, 'operator sign-in refused');
      },
    }),
  });

  const admin = adminRoutes({
    internalToken: config.internalToken,
    listTenants: async () => {
      const rows = await db.execute(sql`
        SELECT t.id, t.slug, t.display_name, t.status, t.created_at,
               count(a.id) FILTER (WHERE a.status = 'active')  AS admins,
               count(a.id) FILTER (WHERE a.status = 'invited') AS pending
          FROM platform.tenant t
          LEFT JOIN platform.account a ON a.tenant_id = t.id
         GROUP BY t.id
         ORDER BY t.created_at DESC
      `);
      return [...rows].map((row) => ({
        id: String(row['id']),
        slug: String(row['slug']),
        displayName: String(row['display_name']),
        status: String(row['status']),
        createdAt: String(row['created_at']),
        admins: Number(row['admins']),
        pendingInvites: Number(row['pending']),
      }));
    },
    provision: provisionTenant({
      inTransaction: (fn) => db.transaction(() => fn()),
      createTenant: async (input) => {
        const rows = await db.execute(sql`
          INSERT INTO platform.tenant (slug, display_name, accent_color)
          VALUES (${input.slug}, ${input.displayName}, ${input.accentColor})
          RETURNING id
        `);
        return String([...rows][0]?.['id']);
      },
      inviteAdmin: async (tenantId, email) => {
        const identityId = uuidv7();
        await db.execute(sql`INSERT INTO platform.identity (id) VALUES (${identityId}::uuid)`);
        const rows = await db.execute(sql`
          INSERT INTO platform.account
            (tenant_id, identity_id, status, work_email, time_zone, employment_start)
          VALUES (${tenantId}::uuid, ${identityId}::uuid, 'invited', ${email},
                  'Etc/UTC', current_date)
          RETURNING id
        `);
        return String([...rows][0]?.['id']);
      },
      issueEnrolment: (tenantId, accountId) =>
        drizzleEnrolmentTokenStore(db, tenantId).issue({
          accountId,
          secondChannel: 'in_person',
          issuedBy: null,
        }),
    }),
  });

  /*
   * Routes, tried in order.
   *
   * A list rather than a router. There are four, matched by prefix, and a
   * routing dependency would be earning its place by saving six lines. It stops
   * being the right answer the moment a path has parameters worth parsing.
   */
  return async (request, response) =>
    jwks(request, response) ||
    (await webauthn(request, response)) ||
    (await enrolment(request, response)) ||
    (await operator(request, response)) ||
    (await admin(request, response)) ||
    (await tenants(request, response));
}
