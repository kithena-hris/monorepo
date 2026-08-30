import {
  AggregateRoot,
  err,
  failure,
  NotFound,
  ok,
  type Clock,
  type PendingEvent,
  type Result,
} from '@kithena/domain-kit';
import { TenantId, type Actor } from '@kithena/contracts';

import { allocateSlot, type Session, type SessionDevice, type SlotAllocation } from './session.js';

/**
 * One human at one company, and the devices they are signed in on.
 *
 * The aggregate boundary is drawn here rather than around a session because
 * the four-device rule spans sessions. Account is therefore the unit of
 * consistency, `Session` has no repository of its own, and the write path
 * loads the whole thing. The read path deliberately does not — answering "is
 * this cookie valid" by loading an aggregate on every request would be absurd,
 * so that question goes to a thin cached query that cannot mutate anything.
 * That split is CQRS in its mild form and is named in docs/code-structure.md,
 * so nobody later finds the shortcut and assumes it was sloppiness.
 */

export type AccountStatus = 'provisioned' | 'invited' | 'active' | 'suspended' | 'terminated';

export type SuspensionReason =
  'garden_leave' | 'investigation' | 'billing' | 'tenant_suspended' | 'security';

export type RevocationReason =
  'signed_out' | 'evicted' | 'expired' | 'revoked_by_user' | 'revoked_by_admin' | 'terminated';

/**
 * Which of the two provisioning paths an account came from.
 *
 * Not a detail: it is the difference between HR entering a hire and a
 * customer's directory pushing one, and an auditor asking "who created this
 * account" wants it. Mirrors the enum on `identity.account.provisioned`.
 */
export type ProvisioningRoute = 'people_module' | 'admin_api' | 'scim';

/**
 * How the second channel was satisfied.
 *
 * Declared here rather than imported from the credential slice, which owns the
 * token: `no-cross-slice-imports` forbids the import and is right to. Both
 * mirror the enum on `identity.account.invited`, which is the vocabulary they
 * actually share.
 */
export type SecondChannel = 'in_person' | 'known_value';

export interface AccountSnapshot {
  readonly id: string;
  readonly identityId: string;
  readonly tenantId: string;
  readonly status: AccountStatus;
  /**
   * Used once, to route the invitation. Never an identifier afterwards — the
   * migration and `identity.account.provisioned` both say so, and `sub` rather
   * than `email` is what a federated login is matched on.
   *
   * It is on the aggregate at all because commissioning raises an event that
   * carries it, and an aggregate that cannot describe the row it is about to
   * write is an aggregate the insert has to work around.
   */
  readonly workEmail: string;
  /** Employment start. A calendar date, which is why `timeZone` is here too. */
  readonly employmentStart: string;
  /** IANA zone. Decides when the start date and the last working day fall. */
  readonly timeZone: string;
  readonly sessions: readonly Session[];
  readonly sessionLimit: number;
}

/**
 * What a transition needs from outside itself, passed in rather than reached for.
 *
 * `CLAUDE.md` bans `new Date()` in domain code because effective-dated logic is
 * untestable otherwise. Event ids are the same problem wearing a different hat:
 * a domain that generates its own is a domain whose output cannot be asserted
 * on without stubbing a global.
 */
export interface EventContext {
  readonly clock: Clock;
  readonly newEventId: () => string;
  readonly actor: Actor;
  readonly correlationId: string;
  readonly causationId: string | null;
}

export interface StartSessionInput {
  readonly id: string;
  readonly device: SessionDevice;
  readonly amr: readonly string[];
}

/** `platform.account.session_limit`'s default. Tenant policy overrides it. */
const DEFAULT_SESSION_LIMIT = 4;

const InvalidTransition = (from: AccountStatus, action: string): ReturnType<typeof failure> =>
  failure('INVALID_TRANSITION', `An account that is ${from} cannot be ${action}`);

/** The acting account, when a person acted. Null for a system or integration. */
function actorAccountId(actor: Actor): string | null {
  return actor.kind === 'user' ? (actor.onBehalfOf ?? actor.userId) : null;
}

export class Account extends AggregateRoot<string> {
  #status: AccountStatus;
  #sessions: Session[];
  readonly #identityId: string;
  readonly #tenantId: TenantId;
  readonly #workEmail: string;
  readonly #employmentStart: string;
  readonly #timeZone: string;
  readonly #sessionLimit: number;

  private constructor(snapshot: AccountSnapshot) {
    super(snapshot.id);
    this.#status = snapshot.status;
    this.#sessions = [...snapshot.sessions];
    this.#identityId = snapshot.identityId;
    // Parsed, not asserted. The Clock in `@kithena/domain-kit` makes the same
    // argument: a brand should mean "this was checked" rather than "someone
    // said so". A malformed tenant id reaching the domain is a bug, and a bug
    // is the one thing worth throwing for.
    this.#tenantId = TenantId.parse(snapshot.tenantId);
    this.#workEmail = snapshot.workEmail;
    this.#employmentStart = snapshot.employmentStart;
    this.#timeZone = snapshot.timeZone;
    this.#sessionLimit = snapshot.sessionLimit;
  }

  /** Rebuild from storage. Raises nothing — this is not a transition. */
  static rehydrate(snapshot: AccountSnapshot): Account {
    return new Account(snapshot);
  }

  /**
   * A new account, commissioned. Nobody can log in yet.
   *
   * Its own factory rather than a second `rehydrate`, because this *is* a
   * transition: it raises `identity.account.provisioned`, and rehydration
   * raises nothing. The two had been the same call for as long as accounts
   * were created by an INSERT in the composition root, which is how a defined
   * contract event ended up being raised by nothing at all.
   *
   * `effectiveFrom` on that event is the employment start date, and it is load
   * bearing rather than informational: a hire entered three weeks early must
   * not be able to enrol during those three weeks. `enrol` is what enforces it;
   * this is what records the date it enforces against.
   */
  static commission(
    input: {
      readonly id: string;
      readonly identityId: string;
      readonly tenantId: string;
      readonly workEmail: string;
      readonly timeZone: string;
      readonly employmentStart: string;
      readonly via: ProvisioningRoute;
      readonly sessionLimit?: number;
    },
    ctx: EventContext,
  ): Account {
    const account = new Account({
      id: input.id,
      identityId: input.identityId,
      tenantId: input.tenantId,
      status: 'provisioned',
      workEmail: input.workEmail,
      employmentStart: input.employmentStart,
      timeZone: input.timeZone,
      sessions: [],
      sessionLimit: input.sessionLimit ?? DEFAULT_SESSION_LIMIT,
    });

    account.#raise(
      'identity.account.provisioned',
      {
        accountId: input.id,
        identityId: input.identityId,
        workEmail: input.workEmail,
        timeZone: input.timeZone,
        employmentStart: input.employmentStart,
        via: input.via,
      },
      ctx,
      // The one event here whose `effectiveFrom` is not null. Everything else
      // an account does takes effect when it is recorded; employment does not.
      input.employmentStart,
    );

    return account;
  }

  /**
   * An enrolment link was issued. The token itself is never in the event.
   *
   * Reachable from `provisioned` and from `invited`, and the second one is the
   * ordinary case rather than the edge: a link lasts 72 hours, people start on
   * Mondays, and issuing a new one invalidates whatever came before. What is
   * refused is an account that has already enrolled — that person needs
   * recovery, which is HR-mediated precisely so that it is not an emailed link.
   */
  invite(
    input: { readonly expiresAt: string; readonly secondChannel: SecondChannel },
    ctx: EventContext,
  ): Result<void> {
    if (this.#status !== 'provisioned' && this.#status !== 'invited') {
      return err(InvalidTransition(this.#status, 'invited'));
    }

    this.#status = 'invited';
    this.#raise(
      'identity.account.invited',
      {
        accountId: this.id,
        expiresAt: input.expiresAt,
        secondChannel: input.secondChannel,
      },
      ctx,
    );
    return ok(undefined);
  }

  get status(): AccountStatus {
    return this.#status;
  }

  get liveSessions(): readonly Session[] {
    return this.#sessions;
  }

  /**
   * Register the first credential. The account becomes usable.
   *
   * Two gates, and they fail differently on purpose: a wrong state is a
   * programming or workflow error, while a start date in the future is a
   * perfectly ordinary thing to be told about and the caller should be able to
   * say so to a person.
   */
  /**
   * A replacement passkey for somebody who lost the one they had.
   *
   * Separate from `enrol` because the state it starts from is different — this
   * one begins at `active` — and because the two mean different things to
   * anybody reading the event stream afterwards. An account that enrolled twice
   * is not a thing that happens; an account that recovered is, and it is worth
   * being able to count.
   *
   * No employment-start check. That gate exists so a new hire cannot sign in
   * before their first day; somebody recovering has been working here, and
   * re-applying it would refuse the one case this exists for.
   *
   * **The old credential is revoked by the caller, not here.** The aggregate
   * does not own credentials — they belong to the human rather than to the job,
   * and one identity's passkey serves every account they hold. Revoking is
   * therefore a decision about the *identity*, made where that is visible.
   */
  recover(credentialId: string, ctx: EventContext): Result<void> {
    if (this.#status !== 'active') return err(InvalidTransition(this.#status, 'recovered'));

    this.#raise('identity.account.recovered', { accountId: this.id, credentialId }, ctx);
    return ok(undefined);
  }

  enrol(credentialId: string, ctx: EventContext): Result<void> {
    if (this.#status !== 'invited') return err(InvalidTransition(this.#status, 'enrolled'));

    if (ctx.clock.date(this.#timeZone) < this.#employmentStart) {
      return err(
        failure('EMPLOYMENT_NOT_STARTED', `Employment begins on ${this.#employmentStart}`, [
          'employmentStart',
        ]),
      );
    }

    this.#status = 'active';
    this.#raise('identity.account.enrolled', { accountId: this.id, credentialId }, ctx);
    return ok(undefined);
  }

  /** Sign a device in, evicting the least recently used one if there is no room. */
  startSession(input: StartSessionInput, ctx: EventContext): Result<SlotAllocation> {
    if (this.#status !== 'active') return err(InvalidTransition(this.#status, 'signed in'));

    const allocation = allocateSlot(this.#sessions, this.#sessionLimit);
    if (!allocation.ok) return allocation;

    const { slot, evicted } = allocation.value;

    // Raised before the start, so a consumer replaying the stream never sees
    // two sessions holding one slot even momentarily.
    if (evicted) this.#revoke(evicted, 'evicted', ctx);

    const at = ctx.clock.instant();
    this.#sessions = [
      ...this.#sessions,
      {
        id: input.id,
        slot,
        startedAt: at,
        lastSeenAt: at,
        amr: input.amr,
        device: input.device,
      },
    ];

    this.#raise(
      'identity.session.started',
      {
        sessionId: input.id,
        accountId: this.id,
        slot,
        amr: input.amr,
        device: input.device,
        evictedSessionId: evicted?.id ?? null,
      },
      ctx,
    );

    return ok(allocation.value);
  }

  revokeSession(sessionId: string, reason: RevocationReason, ctx: EventContext): Result<void> {
    const found = this.#sessions.find((s) => s.id === sessionId);
    if (!found) return err(NotFound('Session'));

    this.#revoke(found, reason, ctx);
    return ok(undefined);
  }

  suspend(reason: SuspensionReason, ctx: EventContext): Result<void> {
    if (this.#status === 'terminated' || this.#status === 'suspended') {
      return err(InvalidTransition(this.#status, 'suspended'));
    }

    const revoked = this.#revokeAll('revoked_by_admin', ctx);
    this.#status = 'suspended';
    this.#raise(
      'identity.account.suspended',
      { accountId: this.id, reason, sessionsRevoked: revoked },
      ctx,
    );
    return ok(undefined);
  }

  /**
   * Lift a suspension.
   *
   * Its own event rather than a second `account.enrolled`. Both end with an
   * active account, but enrolment says a credential now exists and this says a
   * decision was reversed — and reusing the first would have meant raising it
   * with a null `credentialId`, which is a lie in the shape of a nullable
   * field. `raised-events.test.ts` is what caught that.
   */
  reinstate(ctx: EventContext): Result<void> {
    if (this.#status !== 'suspended') return err(InvalidTransition(this.#status, 'reinstated'));

    this.#status = 'active';
    this.#raise(
      'identity.account.reinstated',
      { accountId: this.id, reinstatedBy: actorAccountId(ctx.actor) },
      ctx,
    );
    return ok(undefined);
  }

  /**
   * Employment ended. Terminal, and reachable from every live state.
   *
   * Someone hired who never started still has an account and it still has to
   * be closed; requiring `active` first would leave those open forever. The row
   * survives — employment records outlive employment — so this is a tombstone
   * that cannot log in, not a delete.
   */
  terminate(lastWorkingDay: string, ctx: EventContext): Result<void> {
    if (this.#status === 'terminated') return err(InvalidTransition(this.#status, 'terminated'));

    const revoked = this.#revokeAll('terminated', ctx);
    this.#status = 'terminated';
    this.#raise(
      'identity.account.terminated',
      { accountId: this.id, lastWorkingDay, sessionsRevoked: revoked },
      ctx,
    );
    return ok(undefined);
  }

  #revokeAll(reason: RevocationReason, ctx: EventContext): number {
    const live = this.#sessions;
    for (const s of live) this.#revoke(s, reason, ctx);
    return live.length;
  }

  #revoke(session: Session, reason: RevocationReason, ctx: EventContext): void {
    this.#sessions = this.#sessions.filter((s) => s.id !== session.id);
    this.#raise(
      'identity.session.revoked',
      { sessionId: session.id, accountId: this.id, reason },
      ctx,
    );
  }

  /**
   * The envelope, built once.
   *
   * `effectiveFrom` is null on all but one: an account transition takes effect
   * when it is recorded. The dates that *are* effective-dated travel in the
   * payload instead, because they describe the employment rather than the
   * moment the record changed.
   *
   * The exception is `account.provisioned`, where the employment start date is
   * the envelope's `effectiveFrom` as well — a consumer deciding whether this
   * hire is live yet reads the envelope, not a payload field whose name it
   * would have to know.
   */
  #raise(
    eventName: string,
    payload: Record<string, unknown>,
    ctx: EventContext,
    effectiveFrom: string | null = null,
  ): void {
    const at = ctx.clock.instant();
    const event: PendingEvent = {
      eventId: ctx.newEventId(),
      eventName,
      eventVersion: 1,
      tenantId: this.#tenantId,
      occurredAt: at,
      effectiveFrom: effectiveFrom as PendingEvent['effectiveFrom'],
      aggregate: { type: 'Account', id: this.id, version: this.version + 1 },
      actor: ctx.actor,
      correlationId: ctx.correlationId,
      causationId: ctx.causationId,
      payload,
    };
    this.raise(event);
  }

  /** The human this account belongs to. One human, several accounts. */
  get identityId(): string {
    return this.#identityId;
  }

  /** The row this aggregate describes, for a repository writing it the first time. */
  get commissioned(): {
    readonly identityId: string;
    readonly tenantId: string;
    readonly workEmail: string;
    readonly timeZone: string;
    readonly employmentStart: string;
    readonly sessionLimit: number;
  } {
    return {
      identityId: this.#identityId,
      tenantId: this.#tenantId,
      workEmail: this.#workEmail,
      timeZone: this.#timeZone,
      employmentStart: this.#employmentStart,
      sessionLimit: this.#sessionLimit,
    };
  }

  /** The company. Needed by anything writing a tenant-scoped row. */
  get tenantId(): string {
    return this.#tenantId;
  }
}
