import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { ok, systemClock, type Result } from '@kithena/domain-kit';
import { logger } from '@kithena/telemetry';

import { startSession } from './account/application/start-session.js';
import {
  drizzleAccountRepository,
  findActiveAccountForIdentity,
  loadSession,
  workEmailOf,
} from './account/infrastructure/drizzle-account-repository.js';
import { authenticate } from './account/application/authenticate.js';
import { issueHandoff, redeemHandoff } from './account/application/handoff.js';
import { revokeSession } from './account/application/revoke-session.js';
import { sessionRoutes } from './account/http/session-routes.js';
import { asInstant } from './credential/infrastructure/drizzle-enrolment-token-store.js';
import { Account, type EventContext } from './account/domain/account.js';
import type { AccountRepository } from './account/application/account-repository.js';
import { defaultCredentialPolicy } from './credential/domain/credential.js';
import { signInWithPasskey } from './credential/application/sign-in-with-passkey.js';
import { signIn } from './credential/application/sign-in.js';
import { drizzleCredentialRepository } from './credential/infrastructure/drizzle-credential-repository.js';
import { simpleWebAuthnRelyingParty } from './credential/infrastructure/simplewebauthn-relying-party.js';
import { postgresChallengeStore } from './credential/infrastructure/postgres-challenge-store.js';
import { webauthnRoutes } from './credential/http/webauthn-routes.js';
import { completeEnrolment } from './credential/application/complete-enrolment.js';
import { drizzleEnrolmentTokenStore } from './credential/infrastructure/drizzle-enrolment-token-store.js';
import { enrolmentRoutes } from './credential/http/enrolment-routes.js';
import { brandingFor } from './tenancy/domain/tenant.js';
import { resolveTenant } from './tenancy/application/resolve-tenant.js';
import { drizzleTenantRepository } from './tenancy/infrastructure/drizzle-tenant-repository.js';
import { tenantRoutes } from './tenancy/http/tenant-routes.js';
import { jwksRoute } from './token/http/jwks-route.js';
import { developmentKey, joseSigner } from './token/infrastructure/jose-signer.js';
import { uuidv7 } from './shared/uuid.js';
import { operatorSignIn } from './operator/application/operator-sign-in.js';
import { drizzleOperatorRepository } from './operator/infrastructure/drizzle-operator-repository.js';
import { operatorRoutes } from './operator/http/operator-routes.js';
import { amendTenant } from './tenancy/application/amend-tenant.js';
import { provisionTenant } from './tenancy/application/provision-tenant.js';
import { inviteAccount } from './tenancy/application/invite-account.js';
import { httpInvitationNotifier } from './tenancy/infrastructure/http-invitation-notifier.js';
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
  /**
   * Kept, and unused by default.
   *
   * Challenges live in Postgres now — see
   * `postgres-challenge-store.ts` for why. A deployment with a real always-on
   * Redis can still wire `valkeyChallengeStore` here; the port did not change.
   */
  readonly valkeyUrl?: string | undefined;
  readonly internalToken: string;
  readonly rpId: string;
  /**
   * Hosts an uploaded company image may be served from.
   *
   * Defaulted rather than required, because every deployment today uses Vercel
   * Blob and a required value would be a required value nobody varies. It is
   * configuration so that self-hosting the bucket is a variable rather than an
   * edit to a domain rule and its tests — see `docs/self-hosting.md`.
   */
  readonly imageHosts?: readonly string[] | undefined;
  readonly authOrigin: string;
  readonly signingKey: string | undefined;
  readonly allowInsecureOrigins: boolean;
  /**
   * Where the messaging service is, or absent.
   *
   * Absent is a supported deployment, not a broken one. Provisioning and
   * inviting both return the enrolment link in the response, and
   * `docs/authentication.md` prefers that link handed over in person — so a
   * deployment with no messaging service still works, and every invitation
   * reports itself undelivered rather than pretending otherwise.
   */
  readonly messagingUrl?: string | undefined;
  /**
   * The secret identity presents to the messaging service.
   *
   * Its own, rather than `internalToken`, and that is a security property
   * rather than a naming preference. `INTERNAL_API_TOKEN` is shared by every
   * app that calls identity — the auth origin, the tenant app, the back-office
   * — so reusing it here would mean a leak from any one of those front ends
   * also grants the ability to send Kithena-branded mail to any address.
   *
   * One secret per pair of services is the least privilege version, and it has
   * a practical benefit too: Vercel stores these write-only, so the shared one
   * cannot be read back to copy onto a new service. A separate secret is
   * generated once and set on exactly the two ends that need it, instead of
   * rotating one across six projects and redeploying all of them.
   *
   * Falls back to `internalToken` when unset, so a deployment that has not
   * split them yet keeps working.
   */
  readonly messagingToken?: string | undefined;
}

export type RequestHandler = (
  request: IncomingMessage,
  response: ServerResponse,
) => Promise<boolean>;

/**
 * A column, as text.
 *
 * `String(row['x'])` on a value the driver types as `unknown` renders an object
 * as `[object Object]` — which reaches a screen looking like something somebody
 * typed. These narrow first and are the only way this file reads a row.
 */
function text(value: unknown): string {
  if (typeof value === 'string') return value;
  // Narrowed rather than stringified. Falling through to `String(value)` is
  // what renders an object as `[object Object]`, and a column read that way
  // reaches a screen looking like something a person typed.
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  if (value instanceof Date) return value.toISOString();
  return '';
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/**
 * A human, and the account they hold at one company. Both, or neither.
 *
 * Through the aggregate, not through two INSERTs. That is the whole point of
 * this function existing: creating an account used to be raw SQL right here, so
 * `identity.account.provisioned` was a contract event that nothing ever raised
 * and the audit trail HR is entitled to began at enrolment rather than at hire.
 * `Account.commission` raises it, and `create` drains it into the outbox inside
 * the same transaction as the row.
 *
 * `platform.identity` is written by the repository for the same reason: one
 * human is one identity globally and one account per company, so a contractor
 * at their second customer keeps the identity that carries their passkey.
 */
async function commissionAccount(
  tx: PostgresJsDatabase,
  accounts: AccountRepository,
  input: {
    tenantId: string;
    email: string;
    employmentStart: string;
    timeZone: string;
    via: 'people_module' | 'admin_api' | 'scim';
  },
  ctx: EventContext,
): Promise<{ accountId: string; identityId: string }> {
  const accountId = uuidv7();
  const identityId = uuidv7();

  const account = Account.commission(
    {
      id: accountId,
      identityId,
      tenantId: input.tenantId,
      workEmail: input.email,
      timeZone: input.timeZone,
      employmentStart: input.employmentStart,
      via: input.via,
    },
    ctx,
  );

  await accounts.create(tx, account);
  return { accountId, identityId };
}

/**
 * Mint the link and record that it was issued, as one fact.
 *
 * The order is forced: `identity.account.invited` carries the token's expiry,
 * so the token has to exist before the aggregate can be told about it. Both
 * land in the same transaction, so a link that exists is a link somebody can
 * see was issued.
 */
async function inviteCommissioned(
  tx: PostgresJsDatabase,
  accounts: AccountRepository,
  input: {
    tenantId: string;
    accountId: string;
    issuedBy: string | null;
    secondChannel: 'in_person' | 'known_value';
  },
  ctx: EventContext,
): Promise<Result<{ token: string; expiresAt: string }>> {
  const issued = await drizzleEnrolmentTokenStore(tx, input.tenantId).issue({
    accountId: input.accountId,
    secondChannel: input.secondChannel,
    issuedBy: input.issuedBy,
  });

  const snapshot = await accounts.load(tx, input.accountId);
  if (!snapshot) throw new Error('account vanished mid-invitation');

  const account = Account.rehydrate(snapshot);
  const invited = account.invite(
    { expiresAt: issued.expiresAt, secondChannel: input.secondChannel },
    ctx,
  );
  // The aggregate is the authority. `mayInvite` refused the same set a moment
  // ago with a message the operator can act on; if this still refuses, the
  // state changed underneath us and the transaction should carry nothing.
  if (!invited.ok) return invited;

  await accounts.save(tx, account);
  return ok(issued);
}

/**
 * Where a company's uploaded images are allowed to be served from.
 *
 * The default is the Blob host every deployment uses today, expressed as a
 * suffix so it covers whichever bucket a store happens to get. It lives here
 * rather than in the domain because it is a deployment fact: the rule is "ours
 * or nothing", and this says which host is ours.
 *
 * Two entries are supported so a move between stores can overlap — allow both
 * while URLs are rewritten, then drop the old one.
 */
const DEFAULT_IMAGE_HOSTS = ['.public.blob.vercel-storage.com'] as const;

export async function compose(config: Config): Promise<RequestHandler> {
  const images = { hosts: config.imageHosts ?? DEFAULT_IMAGE_HOSTS };
  /*
   * One connection per instance, and no prepared statements.
   *
   * Both follow from the host being a pooler rather than Postgres itself.
   * Neon's pooled endpoint is PgBouncer in transaction mode, which hands a
   * different server connection to each transaction — so a prepared statement
   * created on one is missing on the next, and postgres.js prepares everything
   * by default. That surfaces as `prepared statement "s1" does not exist` under
   * concurrency and nowhere else, which is the worst way to find it.
   *
   * `max: 1` because the pooler is the pool. A serverless instance handling one
   * request at a time needs one connection, and ten instances each holding ten
   * is how a connection limit is reached without any traffic to justify it.
   *
   * Both are correct against a direct endpoint too — marginally slower, never
   * wrong — so this is not conditional on how it happens to be deployed.
   */
  const db = drizzle(postgres(config.databaseUrl, { max: 1, prepare: false }));

  const signer = await joseSigner(
    config.signingKey === undefined
      ? await developmentKey()
      : (JSON.parse(config.signingKey) as never),
  );

  const relyingParty = simpleWebAuthnRelyingParty({ rpId: config.rpId, rpName: 'Kithena' });
  // Postgres rather than Valkey. The Valkey machine had no services declared,
  // so Fly's proxy could not autostart it: once stopped it stayed stopped, and
  // it took a passkey enrolment with it. This database is the thing identity
  // already cannot run without, so a challenge stored here cannot be down while
  // the service is up.
  const challenges = postgresChallengeStore(db);
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

  /**
   * The same envelope, for acts nobody inside the tenant performed.
   *
   * Commissioning and inviting are done by a back-office operator, who is not
   * one of the customer's employees and has no `platform.account` row there.
   * `Actor` has a `system` arm for exactly this, and naming the process is what
   * an auditor asking "who created this account" actually gets — a `user` arm
   * pointing at an id that does not exist in this tenant would be worse than
   * saying nothing.
   */
  const systemContext = (process: string) => ({
    clock: systemClock,
    newEventId: () => uuidv7(),
    actor: { kind: 'system' as const, process },
    correlationId: randomUUID(),
    causationId: null,
  });

  /*
   * The cookie check the tenant app makes on every request.
   *
   * No cache in front of it yet, which is a deliberate omission rather than an
   * oversight: `SessionCache` exists and Valkey is what `docker-compose.yml`
   * runs, but that machine had no services declared and stopped staying up —
   * the same reason challenges moved to Postgres. A read per request against a
   * primary-key lookup is the honest starting point, and the port is right
   * there when the traffic justifies one.
   */
  /**
   * The handoff store, one statement per operation.
   *
   * Inside a tenant transaction because `platform.handoff_code` carries
   * row-level security with FORCE and `svc_identity` does not bypass it — read
   * on a bare connection every query here returns nothing, which would look
   * like every code being invalid rather than like a misconfiguration.
   *
   * `spend` is a single conditional UPDATE that both claims and reads the row.
   * A SELECT then an UPDATE would leave a window where two requests presenting
   * the same code both pass.
   */
  const handoffStore = {
    put: async (row: {
      tenantId: string;
      sessionId: string;
      codeHash: Buffer;
      expiresAt: Date;
    }): Promise<void> => {
      await inTenantTransaction(row.tenantId, (tx) =>
        tx.execute(sql`
          INSERT INTO platform.handoff_code (tenant_id, session_id, code_hash, expires_at)
          VALUES (${row.tenantId}::uuid, ${row.sessionId}::uuid, ${row.codeHash}, ${row.expiresAt.toISOString()})
        `),
      );
    },
    spend: async (codeHash: Buffer, tenantId: string) => {
      /*
       * Inside the redeeming tenant's transaction, and it has to be.
       *
       * `platform.handoff_code` carries row-level security with FORCE and
       * `svc_identity` does not bypass it, so a statement run without
       * `app.tenant_id` set compares `tenant_id` against NULL and matches
       * nothing — every redemption fails, and it fails looking exactly like an
       * invalid code rather than like a missing setting. That was the first
       * version of this function and the symptom was a sign-in that always
       * refused on the last step.
       *
       * The upside of doing it properly: a code belonging to another company is
       * not visible here at all, so the boundary is enforced by the database
       * and merely *stated* by `checkRedeemable`.
       */
      const rows = await inTenantTransaction(tenantId, (tx) =>
        tx.execute(sql`
          UPDATE platform.handoff_code
             SET redeemed_at = now()
           WHERE code_hash = ${codeHash}
             AND redeemed_at IS NULL
       RETURNING tenant_id, session_id, expires_at, redeemed_at
        `),
      );
      const row = [...rows][0];
      if (!row) return null;

      return {
        tenantId: text(row['tenant_id']),
        sessionId: text(row['session_id']),
        // Through `asInstant` rather than `new Date(...)` directly: Postgres
        // hands back `2026-08-28 12:00:00.123456+00`, which is not ISO 8601,
        // and that function is where the one safe reading of it already lives.
        expiresAt: new Date(asInstant(text(row['expires_at']))),
        // Freshly claimed by the statement above, so this is never null here.
        // The domain still checks it: this function is one implementation of a
        // port, and the rule does not live in the adapter.
        redeemedAt: null,
      };
    },
  };

  const sessions = sessionRoutes({
    internalToken: config.internalToken,
    issueHandoff: issueHandoff({ store: handoffStore, clock: systemClock }),
    redeemHandoff: redeemHandoff({ store: handoffStore, clock: systemClock }),
    authenticate: authenticate({
      cache: {
        read: () => Promise.resolve(null),
        write: () => Promise.resolve(),
        forget: () => Promise.resolve(),
      },
      load: (tenantId, sessionId) =>
        inTenantTransaction(tenantId, (tx) => loadSession(tx, tenantId, sessionId)),
      clock: systemClock,
      /*
       * Sliding the idle window. Not the absolute one — `expires_at` is set at
       * sign-in and never moved, which is what makes thirty days mean thirty
       * days however busy the person has been.
       *
       * Inside a tenant transaction, and the first version was not. That
       * version wrote on a bare connection, where `platform.session`'s FORCE
       * row-level security compares `tenant_id` against NULL, matches no rows
       * and reports success — a sliding window that never slid, indisputable
       * only once you notice `last_seen_at` frozen at the sign-in instant.
       */
      touch: async (tenantId, sessionId, at) => {
        await inTenantTransaction(tenantId, (tx) =>
          tx.execute(sql`
            UPDATE platform.session
               SET last_seen_at = ${at}
             WHERE id = ${sessionId}::uuid
               AND tenant_id = ${tenantId}::uuid
          `),
        );
      },
      onTenantMismatch: (session, presented) => {
        // A *valid* session id arriving on the wrong hostname is somebody
        // moving a cookie between origins. Worth seeing even though the answer
        // is the same refusal as a stale one.
        logger.warn(
          { sessionTenant: session.tenantId, presentedTenant: presented },
          'session presented on another tenant host',
        );
      },
    }),
    workEmailOf: (tenantId, accountId) =>
      inTenantTransaction(tenantId, (tx) => workEmailOf(tx, accountId)),
    /*
     * Signing out, for real.
     *
     * The tenant app used to clear its cookie and stop, which ends that
     * browser's access and leaves the row alive until its absolute lifetime
     * runs out — so a cookie already copied elsewhere kept working. The comment
     * in that route named the gap rather than hiding it; this closes it.
     *
     * `revokeSession` forgets the cache *before* deleting the row, so a failed
     * delete cannot leave a revoked session served from cache.
     */
    revoke: revokeSession({
      cache: {
        read: () => Promise.resolve(null),
        write: () => Promise.resolve(),
        forget: () => Promise.resolve(),
      },
      remove: async (tenantId, sessionId) => {
        await inTenantTransaction(tenantId, (tx) =>
          tx.execute(sql`
            DELETE FROM platform.session
             WHERE id = ${sessionId}::uuid
               AND tenant_id = ${tenantId}::uuid
          `),
        );
      },
    }),
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

  /*
   * How an invited person is told, when there is anywhere to tell them.
   *
   * Over HTTP rather than by importing the sender. Identity holds the signing
   * key and the one plaintext copy of an enrolment token; messaging holds a
   * third party's API key and talks to the public internet on every request.
   * Neither belongs inside the other, and a module will need the second one
   * over the wire anyway — `no-platform-in-modules` sees to that.
   */
  const notifier =
    config.messagingUrl === undefined || config.messagingUrl === ''
      ? undefined
      : httpInvitationNotifier({
          baseUrl: config.messagingUrl,
          internalToken: config.messagingToken ?? config.internalToken,
        });

  if (notifier === undefined) {
    logger.warn(
      { reason: 'no MESSAGING_URL' },
      'invitations will not be emailed; links are returned in the response only',
    );
  }

  /**
   * Reading a company by id, for the invitation path.
   *
   * `platform.tenant` carries no row-level security — it is the table read
   * before a tenant is known — so this needs no tenant transaction, which is
   * also why it can run before one is entered.
   */
  const tenantById = async (
    tenantId: string,
  ): Promise<{ slug: string; displayName: string; logoUrl: string | null } | null> => {
    const rows = await db.execute(sql`
      SELECT slug, display_name, logo_url, accent_color, branding_public
        FROM platform.tenant
       WHERE id = ${tenantId}::uuid
    `);
    const row = [...rows][0];
    if (!row) return null;

    /*
     * The mark goes through `brandingFor`, the name does not.
     *
     * `branding_public` is what a company sets when it does not want to be
     * displayed on a surface it does not control — mid-acquisition, or in a
     * regulated matter. An email is forwarded, so the mark respects it.
     *
     * The company *name* cannot: it is in the subject line, and an invitation
     * that will not say which company it is for is not an invitation. The flag
     * was never about hiding the name from the person who works there; it is
     * about the login page not publishing the customer list to anyone who
     * guesses a slug.
     */
    const branding = brandingFor({
      displayName: text(row['display_name']),
      logoUrl: textOrNull(row['logo_url']),
      accentColor: textOrNull(row['accent_color']),
      brandingPublic: row['branding_public'] !== false,
    });

    return {
      slug: text(row['slug']),
      displayName: text(row['display_name']),
      logoUrl: branding.logoUrl,
    };
  };

  const admin = adminRoutes({
    internalToken: config.internalToken,
    listTenants: async (page) => {
      // Keyset, not OFFSET. `OFFSET 10000` makes Postgres produce and discard
      // ten thousand rows to return ten, so the last page of a large list is
      // the slowest — and this list only grows, because a tenant is never
      // deleted while it holds employment records.
      const cursor = page.cursor;
      const rows = await db.execute(sql`
        SELECT t.id, t.slug, t.display_name, t.status, t.created_at
          FROM platform.tenant t
         WHERE ${
           cursor === null
             ? sql`true`
             : sql`(t.created_at, t.id) < (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)`
         }
         ORDER BY t.created_at DESC, t.id DESC
         LIMIT ${page.limit + 1}
      `);

      const all = [...rows];
      // One more than asked for, so "is there another page" needs no count(*)
      // over the whole table.
      const hasMore = all.length > page.limit;
      const visible = hasMore ? all.slice(0, page.limit) : all;

      // Counts come from a SECURITY DEFINER function, because `platform.account`
      // carries RLS and this listing deliberately spans tenants. Read directly
      // it returns zero for every company — a wrong number rather than an
      // error, which is how it went unnoticed. See the migration for why the
      // function is shaped the way it is.
      const counted = await db.execute(sql`
        SELECT tenant_id, active, invited FROM platform.tenant_account_counts()
      `);
      const counts = new Map(
        [...counted].map((row) => [
          text(row['tenant_id']),
          { active: Number(row['active']), invited: Number(row['invited']) },
        ]),
      );

      const last = visible.at(-1);
      return {
        tenants: visible.map((row) => {
          const id = text(row['id']);
          const count = counts.get(id) ?? { active: 0, invited: 0 };
          return {
            id,
            slug: text(row['slug']),
            displayName: text(row['display_name']),
            status: text(row['status']),
            createdAt: text(row['created_at']),
            admins: count.active,
            pendingInvites: count.invited,
          };
        }),
        nextCursor:
          hasMore && last ? { createdAt: text(last['created_at']), id: text(last['id']) } : null,
      };
    },
    tenantDetail: async (id) => {
      const rows = await db.execute(sql`
        SELECT id, slug, display_name, status, created_at, theme_id,
               logo_url, cover_image_url, branding_public,
               address_country, address_line1,
               address_line2, address_city, address_subdivision, address_postcode
          FROM platform.tenant
         WHERE id = ${id}::uuid
      `);
      const row = [...rows][0];
      if (!row) return null;

      // The people, separately. A join would repeat every tenant column once
      // per administrator, and the caller would have to undo that to render a
      // page that shows the company once.
      //
      // Inside a tenant transaction, because `platform.account` carries RLS
      // with FORCE and `svc_identity` does not bypass it. Read on a bare
      // connection this returns zero rows for every company — not an error, an
      // empty list, which renders as "nobody can sign in" on a company that has
      // three administrators.
      const people = await inTenantTransaction(id, (tx) =>
        tx.execute(sql`
          SELECT id, work_email, status, created_at
            FROM platform.account
           WHERE tenant_id = ${id}::uuid
           ORDER BY created_at
        `),
      );

      const address =
        row['address_country'] === null
          ? null
          : {
              country: text(row['address_country']),
              line1: text(row['address_line1']),
              line2: textOrNull(row['address_line2']),
              city: text(row['address_city']),
              subdivision: textOrNull(row['address_subdivision']),
              postcode: textOrNull(row['address_postcode']),
            };

      return {
        id: String(row['id']),
        slug: String(row['slug']),
        displayName: String(row['display_name']),
        status: String(row['status']),
        createdAt: String(row['created_at']),
        themeId: textOrNull(row['theme_id']),
        logoUrl: textOrNull(row['logo_url']),
        coverImageUrl: textOrNull(row['cover_image_url']),
        brandingPublic: row['branding_public'] !== false,
        address,
        people: [...people].map((person) => ({
          id: String(person['id']),
          email: String(person['work_email']),
          status: String(person['status']),
          createdAt: String(person['created_at']),
        })),
      };
    },
    invite: inviteAccount({
      tenantById,
      authOrigin: config.authOrigin,
      clock: systemClock,
      ...(notifier === undefined ? {} : { notifier }),
      inTenantTransaction: (tenantId, fn) =>
        inTenantTransaction(tenantId, (tx) =>
          fn({
            findByEmail: async (email) => {
              // Inside the tenant transaction, so row-level security is doing
              // the scoping. The `tenant_id` predicate is belt and braces: read
              // on a bare connection this returns nothing at all, which is a
              // wrong answer rather than an error.
              const rows = await tx.execute(sql`
                SELECT id, identity_id, status
                  FROM platform.account
                 WHERE tenant_id = ${tenantId}::uuid AND work_email = ${email}
              `);
              const row = [...rows][0];
              if (!row) return null;
              return {
                accountId: text(row['id']),
                identityId: text(row['identity_id']),
                status: text(row['status']),
              };
            },
            commission: (input) =>
              commissionAccount(
                tx,
                accounts,
                { tenantId, via: 'admin_api', ...input },
                // The commissioning act has no account inside the tenant to
                // attribute it to — a back-office operator is not one of the
                // customer's employees — so the actor is the process.
                systemContext('invite-account'),
              ),
            invite: (input) =>
              inviteCommissioned(
                tx,
                accounts,
                { tenantId, ...input },
                systemContext('invite-account'),
              ),
          }),
        ),
    }),
    /*
     * Editing a company. One statement, and the row count is the answer to
     * "did that company exist" — see `amendTenant` for why it is not a read
     * followed by a write.
     *
     * No tenant transaction. `platform.tenant` carries no row-level security
     * by design: it is the table read before a tenant is known, so there is no
     * `app.tenant_id` for a policy to compare against. The authorisation that
     * matters happened at the route, which requires the internal token.
     */
    amend: amendTenant({
      images,
      write: async (tenantId, change) => {
        const rows = await db.execute(sql`
          UPDATE platform.tenant
             SET display_name = ${change.displayName},
                 theme_id = ${change.themeId},
                 logo_url = ${change.logoUrl},
                 cover_image_url = ${change.coverImageUrl},
                 branding_public = ${change.brandingPublic},
                 address_country = ${change.address.country.toUpperCase()},
                 address_line1 = ${change.address.line1},
                 address_line2 = ${change.address.line2},
                 address_city = ${change.address.city},
                 address_subdivision = ${change.address.subdivision},
                 address_postcode = ${change.address.postcode},
                 updated_at = now()
           WHERE id = ${tenantId}::uuid
    RETURNING id
        `);
        return [...rows].length === 1;
      },
    }),
    provision: provisionTenant({
      images,
      authOrigin: config.authOrigin,
      ...(notifier === undefined ? {} : { notifier }),
      // The scope is built *inside* the transaction and every statement uses
      // `tx`. Building it outside would hand back closures over the pool, which
      // is what made this four transactions and lost the `app.tenant_id` that
      // row-level security needs.
      inTransaction: (fn) =>
        db.transaction(async (tx) =>
          fn({
            createTenant: async (input) => {
              const rows = await tx.execute(sql`
                INSERT INTO platform.tenant (
                  slug, display_name, theme_id, logo_url, cover_image_url,
                  address_country, address_line1, address_line2,
                  address_city, address_subdivision, address_postcode
                )
                VALUES (
                  ${input.slug}, ${input.displayName}, ${input.themeId},
                  ${input.logoUrl}, ${input.coverImageUrl},
                  ${input.address.country.toUpperCase()}, ${input.address.line1},
                  ${input.address.line2}, ${input.address.city},
                  ${input.address.subdivision}, ${input.address.postcode}
                )
                RETURNING id
              `);
              return text([...rows][0]?.['id']);
            },
            enterTenant: async (tenantId) => {
              // `true` makes it LOCAL: it lasts to the end of this transaction
              // and no further. Session-level would leak this tenant's id onto
              // whatever the pooled connection served next.
              await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
            },
            inviteAdmin: async (tenantId, email) => {
              const ctx = systemContext('provision-tenant');
              const commissioned = await commissionAccount(
                tx,
                accounts,
                {
                  tenantId,
                  email,
                  // A company's first administrators start when the company
                  // does. There is no employment record to read yet — the
                  // People module does not exist for this tenant at the moment
                  // it is created — so today is the honest answer rather than a
                  // default standing in for one.
                  employmentStart: systemClock.date('Etc/UTC'),
                  timeZone: 'Etc/UTC',
                  via: 'admin_api',
                },
                ctx,
              );

              const issued = await inviteCommissioned(
                tx,
                accounts,
                {
                  tenantId,
                  accountId: commissioned.accountId,
                  issuedBy: null,
                  secondChannel: 'in_person',
                },
                ctx,
              );
              // A freshly commissioned account cannot refuse an invitation, so
              // this is a bug rather than a condition — and it has to abort the
              // transaction rather than return a half-provisioned company.
              if (!issued.ok) throw new Error(`invitation refused: ${issued.error.code}`);

              return { ...commissioned, ...issued.value };
            },
          }),
        ),
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
    (await sessions(request, response)) ||
    (await webauthn(request, response)) ||
    (await enrolment(request, response)) ||
    (await operator(request, response)) ||
    (await admin(request, response)) ||
    (await tenants(request, response));
}
