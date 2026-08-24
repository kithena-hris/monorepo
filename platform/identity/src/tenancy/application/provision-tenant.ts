import { ok, type Result } from '@kithena/domain-kit';
import type { PostalAddress } from '@kithena/contracts';

import { enrolmentLink } from '../domain/invitation.js';
import { checkProvisionable, type ProvisionRequest } from '../domain/provision.js';
import { notDelivered, type Delivery, type InvitationNotifier } from './invitation-notifier.js';

/**
 * Creating a customer, and inviting the people who will run it.
 *
 * One transaction from end to end: the tenant, its administrators and their
 * links commit together or not at all. Half of it is a company that exists with
 * nobody able to reach it, which looks like a working signup right up until
 * somebody tries to log in.
 *
 * **Nothing here enrols a credential.** The operator creating the customer
 * names people and each is sent their own single-use link; whoever enrols does
 * so themselves. If one person could do both, a single compromised back-office
 * laptop would be a silent, complete takeover of a new customer — and in the
 * logs it would look exactly like normal onboarding.
 */
export interface ProvisionedTenant {
  readonly tenantId: string;
  readonly slug: string;
  /** One per administrator. Shown once and never retrievable. */
  readonly invitations: readonly Invitation[];
}

/**
 * What the operator is handed for each administrator.
 *
 * `token` and `enrolUrl` both, because they are for different people. The
 * operator reads the link when they have to pass it on themselves; the token is
 * what the back-office has displayed since this endpoint existed, and removing
 * it would break a screen for no gain.
 *
 * `delivery` is here because the answer is not always yes. A messaging service
 * that is down must not fail the provisioning — the company exists and the
 * links work — but the operator has to know that they are now the channel.
 */
export interface Invitation {
  readonly email: string;
  readonly token: string;
  readonly enrolUrl: string;
  readonly delivery: Delivery;
}

/**
 * The writes, as one unit of work.
 *
 * These are methods on a scope rather than four independent dependencies, and
 * that is the whole point: the previous shape handed out four closures over a
 * connection *pool*, so `db.transaction(() => fn())` opened a transaction whose
 * handle nobody used and every statement inside it ran on a different
 * connection. It was four transactions wearing one comment.
 *
 * That is not a tidiness problem. `enterTenant` sets `app.tenant_id` with
 * `set_config(..., true)`, which is scoped to *its* transaction — so on a
 * separate connection the setting was gone before the next statement, and the
 * account insert was refused by row-level security with 42501. A shape that
 * cannot express "these run together" is a shape where this recurs.
 */
export interface ProvisionScope {
  /** Writes the tenant. Expected to throw on a duplicate label. */
  createTenant: (input: {
    slug: string;
    displayName: string;
    themeId: string;
    logoUrl: string | null;
    coverImageUrl: string | null;
    address: PostalAddress;
  }) => Promise<string>;
  /**
   * Sets the row-level-security context for the rest of the transaction.
   *
   * Separate from opening the transaction because the tenant id does not exist
   * until `createTenant` has run. `platform.tenant` carries no RLS — it is read
   * before a tenant is known — which is why that insert succeeds without this
   * and everything after it does not.
   */
  enterTenant: (tenantId: string) => Promise<void>;
  /**
   * Creates an invited account and returns its ids.
   *
   * Both of them. The identity id is what the enrolment page presents to the
   * authenticator, so a link cannot be built without it — this returned only
   * the account id until invitations were actually sent anywhere, at which
   * point the missing half stopped being an implementation detail.
   */
  /**
   * Commissions an administrator's account, invites it, and issues the link.
   *
   * One operation rather than three, because they are one fact and they have
   * to be. Commissioning raises `identity.account.provisioned`, inviting raises
   * `identity.account.invited`, and the second event carries the token's
   * expiry — so the token must exist before the aggregate can be told about it,
   * and a scope that could do any one of the three alone could leave a company
   * with an account nobody recorded inviting.
   *
   * The deadline comes back from the database rather than being recomputed,
   * because the database is what set it. A message stating a different expiry
   * from the row is wrong on exactly the detail somebody acts on.
   */
  inviteAdmin: (
    tenantId: string,
    email: string,
  ) => Promise<{
    accountId: string;
    identityId: string;
    token: string;
    expiresAt: string;
  }>;
}

export interface ProvisionTenantDeps {
  readonly inTransaction: <T>(fn: (scope: ProvisionScope) => Promise<T>) => Promise<T>;
  /** Where enrolment happens. Always the auth origin, never a tenant host. */
  readonly authOrigin: string;
  /**
   * How the administrators are told.
   *
   * Optional, and that is deliberate rather than lazy. A deployment without a
   * messaging service still has to be able to create a customer — the links
   * come back in the response and `docs/authentication.md` prefers them handed
   * over in person anyway. Absent, every invitation reports itself undelivered,
   * which is honest; a silent no-op here would look exactly like a working
   * send.
   */
  readonly notifier?: InvitationNotifier | undefined;
}

export type ProvisionTenant = (request: ProvisionRequest) => Promise<Result<ProvisionedTenant>>;

export function provisionTenant(deps: ProvisionTenantDeps): ProvisionTenant {
  return async (request) => {
    // Everything knowable without a query, first. Availability of the label is
    // not checked here on purpose: that is a unique index, and asking the
    // database before writing would be a check-then-act with a gap in it.
    const checked = checkProvisionable(request);
    if (!checked.ok) return checked;

    const provisioned = await deps.inTransaction(async (scope) => {
      const tenantId = await scope.createTenant({
        slug: checked.value.slug,
        displayName: checked.value.displayName.trim(),
        themeId: checked.value.themeId,
        logoUrl: checked.value.logoUrl,
        coverImageUrl: checked.value.coverImageUrl,
        address: checked.value.address,
      });

      // Before any row scoped to this tenant.
      await scope.enterTenant(tenantId);

      const issued: {
        email: string;
        token: string;
        expiresAt: string;
        identityId: string;
      }[] = [];
      for (const email of checked.value.admins) {
        const { token, expiresAt, identityId } = await scope.inviteAdmin(tenantId, email);
        issued.push({ email, token, expiresAt, identityId });
      }

      return ok({ tenantId, slug: checked.value.slug, issued });
    });

    if (!provisioned.ok) return provisioned;
    const { tenantId, slug, issued } = provisioned.value;

    /*
     * After the commit, never inside it.
     *
     * An email cannot be rolled back, so a send inside the transaction would be
     * claiming a guarantee that does not exist — and it would hold a Postgres
     * connection open across a call to a third party while doing it. The
     * transaction is the truth; the messages are a best effort on top of it,
     * and the links are in the response either way.
     */
    const invitations: Invitation[] = [];
    for (const admin of issued) {
      const link = enrolmentLink({
        authOrigin: deps.authOrigin,
        slug,
        identityId: admin.identityId,
        token: admin.token,
        workEmail: admin.email,
      });

      if (!link.ok) {
        // A misconfigured auth origin. The customer exists and the tokens are
        // valid, so this is reported rather than raised — and it is reported
        // per invitation, because that is where an operator will look.
        invitations.push({
          email: admin.email,
          token: admin.token,
          enrolUrl: '',
          delivery: notDelivered('link_unbuildable'),
        });
        continue;
      }

      invitations.push({
        email: admin.email,
        token: admin.token,
        enrolUrl: link.value,
        delivery:
          deps.notifier === undefined
            ? notDelivered('no_messaging_service')
            : await deps.notifier.send({
                tenantId,
                companyName: checked.value.displayName.trim(),
                email: admin.email,
                enrolUrl: link.value,
                expiresAt: admin.expiresAt,
                // A company being created does not have a resolved mark yet.
                // The wizard uploads one, but nothing has been through
                // `brandingFor` at this point, and guessing is worse than a
                // clean message.
                logoUrl: null,
              }),
      });
    }

    return ok({ tenantId, slug, invitations });
  };
}
