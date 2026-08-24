import { err, failure, ok, type Clock, type Result } from '@kithena/domain-kit';

import {
  checkEmployment,
  enrolmentLink,
  mayInvite,
  normaliseWorkEmail,
} from '../domain/invitation.js';
import { notDelivered, type Delivery, type InvitationNotifier } from './invitation-notifier.js';

/**
 * Inviting one person into a company that already exists.
 *
 * `provisionTenant` does this for the first administrators as part of creating
 * a customer. This is the same act on its own, which is what HR does every time
 * somebody is hired — and until now there was no way to do it at all: the only
 * path to an enrolment link was creating a whole new tenant, or the seed
 * script.
 *
 * ### The order matters, and it is not the obvious one
 *
 * Everything that touches the database commits first, and the message is sent
 * afterwards. Sending inside the transaction would hold a Postgres connection
 * open across a call to a third party — and worse, it would imply a rollback
 * can unsend an email. It cannot. So the transaction is the truth, the message
 * is a best effort on top of it, and the link comes back in the response so
 * that a failed send is an inconvenience rather than a person who cannot start
 * work.
 */

export interface InviteAccountRequest {
  readonly tenantId: string;
  readonly email: string;
  /**
   * Who authorised it. Null when the platform provisions a tenant, because
   * there is no account inside that tenant yet to name.
   */
  readonly issuedBy: string | null;
  /**
   * When the person actually starts. Defaults to today in their zone.
   *
   * Taking this is what makes `Account.enrol`'s start-date gate reachable at
   * all: an account commissioned with today's date can be enrolled the moment
   * the link arrives, which is right for somebody starting today and wrong for
   * the hire entered three weeks early.
   */
  readonly employmentStart?: string | undefined;
  /** IANA. Decides when that date falls. Defaults to UTC. */
  readonly timeZone?: string | undefined;
  /**
   * Which second channel the employer satisfied.
   *
   * Recorded, not enforced — `docs/authentication.md` explains why that gap
   * exists and what closes it. Recording it is what makes the claim checkable
   * after the fact rather than assumed.
   */
  readonly secondChannel?: 'in_person' | 'known_value' | undefined;
}

export interface InvitedAccount {
  readonly accountId: string;
  readonly email: string;
  /** Returned once. The row holds only the token's hash. */
  readonly enrolUrl: string;
  readonly expiresAt: string;
  /** Echoed back so the operator can see what the account was created against. */
  readonly employmentStart: string;
  readonly timeZone: string;
  readonly delivery: Delivery;
}

export const TenantUnknown = failure('TENANT_UNKNOWN', 'No such company', ['tenantId']);

/**
 * The writes, as one unit of work.
 *
 * Methods on a scope rather than independent closures, for the reason
 * `provision-tenant.ts` sets out at length: closures over a *pool* run each
 * statement on a different connection, and `app.tenant_id` is set with
 * `set_config(..., true)`, which is scoped to the transaction that set it. A
 * shape that cannot express "these run together" is a shape where row-level
 * security refuses the second statement with a 42501 and nothing says why.
 */
export interface InviteScope {
  /** The account holding this address at this company, or null. */
  findByEmail: (email: string) => Promise<{
    accountId: string;
    identityId: string;
    status: string;
  } | null>;
  /**
   * Commissions the account through the aggregate, raising
   * `identity.account.provisioned` into the outbox alongside the row.
   */
  commission: (input: {
    email: string;
    employmentStart: string;
    timeZone: string;
  }) => Promise<{ accountId: string; identityId: string }>;
  /**
   * Mints the single-use link and records the invitation on the aggregate,
   * which raises `identity.account.invited`.
   *
   * One operation rather than two because it is one fact: the event carries the
   * token's expiry, so the token has to exist before the aggregate can be told
   * about it, and a caller that could do the first without the second could
   * issue a link nobody ever recorded issuing.
   */
  invite: (input: {
    accountId: string;
    issuedBy: string | null;
    secondChannel: 'in_person' | 'known_value';
  }) => Promise<Result<{ token: string; expiresAt: string }>>;
}

export interface InviteAccountDeps {
  /** The company, for the link's slug and the message's subject. */
  readonly tenantById: (tenantId: string) => Promise<{
    slug: string;
    displayName: string;
    /** Already through `brandingFor`. Null means "do not show a mark". */
    logoUrl: string | null;
  } | null>;
  readonly inTenantTransaction: <T>(
    tenantId: string,
    fn: (scope: InviteScope) => Promise<T>,
  ) => Promise<T>;
  readonly authOrigin: string;
  /** For today's date, when an invitation does not carry a start date. */
  readonly clock: Clock;
  /**
   * How the person is told, when there is anywhere to tell them.
   *
   * Optional for the same reason it is on `provisionTenant`: a deployment with
   * no messaging service still has to be able to invite somebody, because the
   * link comes back in the response and handing it over in person is the
   * channel `docs/authentication.md` prefers. Absent, the invitation reports
   * itself undelivered — which is honest, where a silent no-op would look
   * exactly like a working send.
   */
  readonly notifier?: InvitationNotifier | undefined;
}

export type InviteAccount = (request: InviteAccountRequest) => Promise<Result<InvitedAccount>>;

export function inviteAccount(deps: InviteAccountDeps): InviteAccount {
  return async (request) => {
    const email = normaliseWorkEmail(request.email);
    const secondChannel = request.secondChannel ?? 'in_person';

    const tenant = await deps.tenantById(request.tenantId);
    if (tenant === null) return err(TenantUnknown);

    // Defaulting happens inside the check, not before it. Asking the clock for
    // today in an unknown zone throws, so a caller's typo would have been a 500
    // rather than a refusal if this filled the blanks in first.
    const employment = checkEmployment(
      { employmentStart: request.employmentStart, timeZone: request.timeZone },
      deps.clock,
    );
    if (!employment.ok) return employment;

    const issued = await deps.inTenantTransaction(
      request.tenantId,
      async (
        scope,
      ): Promise<
        Result<{ identityId: string; accountId: string; token: string; expiresAt: string }>
      > => {
        const existing = await scope.findByEmail(email);

        if (existing !== null) {
          // A reason the operator can act on, before anything is written. The
          // aggregate refuses the same set authoritatively a moment later; this
          // is what turns "INVALID_TRANSITION" into "use recovery instead".
          const allowed = mayInvite(existing.status);
          if (!allowed.ok) return allowed;
        }

        const account =
          existing ??
          (await scope.commission({
            email,
            employmentStart: employment.value.employmentStart,
            timeZone: employment.value.timeZone,
          }));

        const issuedToken = await scope.invite({
          accountId: account.accountId,
          issuedBy: request.issuedBy,
          secondChannel,
        });
        if (!issuedToken.ok) return issuedToken;

        return ok({
          accountId: account.accountId,
          identityId: account.identityId,
          ...issuedToken.value,
        });
      },
    );
    if (!issued.ok) return issued;

    const link = enrolmentLink({
      authOrigin: deps.authOrigin,
      slug: tenant.slug,
      identityId: issued.value.identityId,
      token: issued.value.token,
      workEmail: email,
    });
    // A misconfigured auth origin. The account and the token are already
    // committed, which is fine — the link is rebuildable and the token is not
    // consumed by having been minted.
    if (!link.ok) return link;

    // After the commit, and it cannot fail the invitation. See the note above.
    const delivery =
      deps.notifier === undefined
        ? notDelivered('no_messaging_service')
        : await deps.notifier.send({
            tenantId: request.tenantId,
            companyName: tenant.displayName,
            email,
            enrolUrl: link.value,
            expiresAt: issued.value.expiresAt,
            // Resolved by the caller supplying `tenantById`, which runs it
            // through `brandingFor`. Null here means the company asked not to
            // be shown, which the messaging service never has to know.
            logoUrl: tenant.logoUrl,
          });

    return ok({
      accountId: issued.value.accountId,
      email,
      enrolUrl: link.value,
      expiresAt: issued.value.expiresAt,
      employmentStart: employment.value.employmentStart,
      timeZone: employment.value.timeZone,
      delivery,
    });
  };
}
