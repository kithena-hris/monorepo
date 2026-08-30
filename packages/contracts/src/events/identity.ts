import * as z from 'zod';
import { defineEvent } from '../event.js';
import { CalendarDate } from '../primitives.js';
import { policy, asContact, asInternal, asPublic } from '../classification.js';

/**
 * The identity lifecycle, as events.
 *
 * Identity is a platform service rather than a module, so nothing here has a
 * `ModuleKey` and there is no manifest declaring it. What it does have is the
 * same obligation as every other contract: a field with no classification
 * fails `pnpm codegen`, and the same walk emits the Pino redaction paths, the
 * AI deny list and the DSAR manifest.
 *
 * That obligation bites harder here than anywhere else. These payloads carry
 * the IP address, device and login time of every employee at every customer —
 * which is personal data under GDPR whether or not it feels like it, and which
 * a works council will ask about specifically.
 */

/* -------------------------------------------------------------- identity -- */

/**
 * A human, globally. Deliberately opaque and deliberately not a `PersonId`.
 *
 * One human working for three customers is one identity and three accounts,
 * which is what lets them carry one passkey across all three. It is also the
 * value stored in the WebAuthn `userHandle`, which syncs to the authenticator
 * vendor's cloud — so it must never be an email or an employee number.
 */
export const IdentityId = z.uuid().brand<'IdentityId'>().register(policy, asPublic());
export type IdentityId = z.infer<typeof IdentityId>;

/** One human at one company. Tenant-scoped; the unit access is granted against. */
export const AccountId = z.uuid().brand<'AccountId'>().register(policy, asPublic());
export type AccountId = z.infer<typeof AccountId>;

export const SessionId = z.uuid().brand<'SessionId'>().register(policy, asPublic());
export type SessionId = z.infer<typeof SessionId>;

export const CredentialId = z.uuid().brand<'CredentialId'>().register(policy, asPublic());
export type CredentialId = z.infer<typeof CredentialId>;

/**
 * How someone proved who they were. RFC 8176 authentication method references.
 *
 * `pwd` and `sms` are listed because a tenant may enable them, not because we
 * recommend them — SP 800-63B-4 downgrades SMS and the policy floor forbids
 * either as a sole factor for a privileged role. Recording which was used is
 * what makes that floor auditable rather than aspirational.
 */
export const Amr = z.enum(['pwd', 'otp', 'sms', 'swk', 'hwk', 'user', 'pin', 'mfa', 'federated']);
export type Amr = z.infer<typeof Amr>;

/**
 * Where a session came from.
 *
 * Every field is personal data. The IP is truncated before it is stored for
 * longer than the forensics window — a full address is a home address for
 * anyone working remotely, which is exactly the kind of field that ends up in
 * a log, an export and a model prompt on the same afternoon.
 */
const DeviceContext = z.object({
  /** Null when unknown. A placeholder string here reaches an `inet` column. */
  ip: z.string().nullable().register(policy, asContact()),
  userAgent: z.string().nullable().register(policy, asContact()),
  /** The authenticator model, from WebAuthn. Not a device identifier. */
  aaguid: z.string().nullable().register(policy, asInternal()),
});

/* --------------------------------------------------------------- account -- */

/**
 * HR created an account. Nobody can log in yet.
 *
 * `effectiveFrom` on the envelope is the employment start date, and it is load
 * bearing rather than informational: a hire entered three weeks early must not
 * be able to enrol and log in during those three weeks. The domain enforces it,
 * which is why the account carries the time zone — a start date is a calendar
 * date, and "has the 1st arrived" has no answer without one.
 */
export const AccountProvisioned = defineEvent(
  'identity.account.provisioned',
  1,
  z.object({
    accountId: AccountId,
    identityId: IdentityId,
    /** Used once, to route the invitation. Never an identifier afterwards. */
    workEmail: z.email().register(policy, asContact()),
    /** IANA zone. Decides when the start date and the last working day fall. */
    timeZone: z.string().register(policy, asInternal()),
    employmentStart: CalendarDate,
    /**
     * Which of the two provisioning paths this came from. Not a detail: it is
     * the difference between HR entering a hire and a customer's directory
     * pushing one, and an auditor asked "who created this account" wants it.
     */
    via: z.enum(['people_module', 'admin_api', 'scim']).register(policy, asPublic()),
  }),
);

/** An enrolment token was issued. The token itself is never in the event. */
export const AccountInvited = defineEvent(
  'identity.account.invited',
  1,
  z.object({
    accountId: AccountId,
    expiresAt: z.iso.datetime({ offset: true }).register(policy, asInternal()),
    /**
     * Whether the second channel was satisfied in person or by a known value.
     * SP 800-63B-4 deprecates email OTP, so an emailed link alone is not an
     * enrolment; recording which second channel was used is what makes that
     * checkable after the fact.
     */
    secondChannel: z.enum(['in_person', 'known_value']).register(policy, asPublic()),
  }),
);

/** The person registered their first credential. The account is now usable. */
export const AccountEnrolled = defineEvent(
  'identity.account.enrolled',
  1,
  z.object({
    accountId: AccountId,
    credentialId: CredentialId,
  }),
);

/**
 * A lost passkey was replaced with a new one.
 *
 * Distinct from enrolment although both end with a usable credential. Enrolment
 * is the first one and is gated by a second channel — in person, or a value
 * only the person and their HR team know. Recovery is not: it is requested with
 * an email address and answered with a link to that address, which is a weaker
 * proof and is recorded as its own event precisely so the difference is
 * countable rather than lost.
 *
 * SP 800-63B-4 deprecates email as a channel, and `docs/auth-administration.md`
 * explains why enrolment does not use it. This path was asked for deliberately,
 * with that trade understood: recovery is instant and self-service, and
 * whoever holds the mailbox can take the account. The event exists so that is
 * visible in the stream rather than indistinguishable from a first enrolment.
 */
export const AccountRecovered = defineEvent(
  'identity.account.recovered',
  1,
  z.object({
    accountId: AccountId,
    credentialId: CredentialId,
  }),
);

/**
 * A suspension was lifted. Distinct from enrolment, which it superficially
 * resembles — both end with an active account.
 *
 * They are separate events because they answer different questions. Enrolment
 * says a credential now exists; reinstatement says a decision was reversed, and
 * carries who reversed it. Collapsing them would have meant raising
 * `account.enrolled` with a null credential, which is a lie in the shape of a
 * nullable field.
 */
export const AccountReinstated = defineEvent(
  'identity.account.reinstated',
  1,
  z.object({
    accountId: AccountId,
    /** The account that lifted it. Never the one being reinstated. */
    reinstatedBy: AccountId.nullable(),
  }),
);

export const AccountSuspended = defineEvent(
  'identity.account.suspended',
  1,
  z.object({
    accountId: AccountId,
    /** An enum, not free text. A reason someone types is a reason that ends up
     *  holding a diagnosis, and this event is not special-category storage. */
    reason: z
      .enum(['garden_leave', 'investigation', 'billing', 'tenant_suspended', 'security'])
      .register(policy, asInternal()),
    /** How many live sessions were destroyed. Useful when reading an incident. */
    sessionsRevoked: z.int().nonnegative().register(policy, asInternal()),
  }),
);

/**
 * Employment ended and access is gone. Terminal.
 *
 * The account row survives — employment records outlive employment, and
 * `platform.tenant` makes the same argument about tenants. A tombstone that
 * cannot log in, not a DELETE.
 */
export const AccountTerminated = defineEvent(
  'identity.account.terminated',
  1,
  z.object({
    accountId: AccountId,
    lastWorkingDay: CalendarDate,
    sessionsRevoked: z.int().nonnegative().register(policy, asInternal()),
  }),
);

/* --------------------------------------------------------------- session -- */

export const SessionStarted = defineEvent(
  'identity.session.started',
  1,
  z.object({
    sessionId: SessionId,
    accountId: AccountId,
    /** 1..limit. The device slot the unique index allocated. */
    slot: z.int().positive().register(policy, asInternal()),
    amr: z.array(Amr).register(policy, asInternal()),
    device: DeviceContext,
    /**
     * The session evicted to make room, if the account was at its limit.
     * Present here so a consumer can drop the cache entry and notify without
     * having to re-derive which one lost its slot.
     */
    evictedSessionId: SessionId.nullable(),
  }),
);

export const SessionRevoked = defineEvent(
  'identity.session.revoked',
  1,
  z.object({
    sessionId: SessionId,
    accountId: AccountId,
    reason: z
      .enum([
        'signed_out',
        'evicted',
        'expired',
        'revoked_by_user',
        'revoked_by_admin',
        'terminated',
      ])
      .register(policy, asInternal()),
  }),
);

/* ------------------------------------------------------------ credential -- */

export const CredentialRegistered = defineEvent(
  'identity.credential.registered',
  1,
  z.object({
    credentialId: CredentialId,
    /** Keyed to the human, not the employer. One passkey, several accounts. */
    identityId: IdentityId,
    kind: z.enum(['passkey', 'federated', 'password']).register(policy, asPublic()),
    /** For a passkey, the authenticator model. For a federated link, the issuer. */
    provider: z.string().nullable().register(policy, asPublic()),
    /** Whether the authenticator can leave the device it was created on. */
    backedUp: z.boolean().register(policy, asInternal()),
  }),
);

export const CredentialRemoved = defineEvent(
  'identity.credential.removed',
  1,
  z.object({
    credentialId: CredentialId,
    identityId: IdentityId,
    reason: z
      .enum(['by_user', 'by_admin', 'recovery', 'compromised'])
      .register(policy, asInternal()),
  }),
);

/* -------------------------------------------------------------- recovery -- */

/**
 * Someone lost their authenticator and asked for a new setup link.
 *
 * **This was a mediated path and is now self-service.** It used to say there
 * was nothing to phish here, because recovery went through an HR admin who
 * could verify the person the way they already can. That is no longer true: a
 * request is made with an email address and answered with a link to that
 * address, so whoever holds the mailbox can take the account.
 *
 * The trade was made deliberately — the alternative asked somebody to present
 * the passkey they had just lost — and it is written down rather than left for
 * a reader to infer from the code. SP 800-63B-4 deprecates email as a channel
 * and `docs/auth-administration.md` explains why first enrolment does not use
 * it; recovery now does. `AccountRecovered` is a separate event from
 * `AccountEnrolled` so the weaker path stays countable.
 *
 * `RecoveryApproved` is unused while recovery is self-service. It is kept
 * because reinstating an approval step is a product decision, not a schema
 * migration, and deleting the event would make that decision cost more than it
 * should.
 */
export const RecoveryRequested = defineEvent(
  'identity.recovery.requested',
  1,
  z.object({
    accountId: AccountId,
    device: DeviceContext,
  }),
);

export const RecoveryApproved = defineEvent(
  'identity.recovery.approved',
  1,
  z.object({
    accountId: AccountId,
    /** The HR admin who approved. Never the same account being recovered. */
    approvedBy: AccountId,
    /** The delay before the enrolment token becomes usable. Non-zero on
     *  purpose: it is the window in which the real owner can object. */
    usableAfter: z.iso.datetime({ offset: true }).register(policy, asInternal()),
  }),
);

export const identityEvents = [
  AccountProvisioned,
  AccountInvited,
  AccountEnrolled,
  AccountRecovered,
  AccountReinstated,
  AccountSuspended,
  AccountTerminated,
  SessionStarted,
  SessionRevoked,
  CredentialRegistered,
  CredentialRemoved,
  RecoveryRequested,
  RecoveryApproved,
] as const;
