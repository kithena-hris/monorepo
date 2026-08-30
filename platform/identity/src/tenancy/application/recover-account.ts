import type { Clock } from '@kithena/domain-kit';

import { enrolmentLink, normaliseWorkEmail } from '../domain/invitation.js';
import { mayRecover } from '../domain/recovery.js';
import type { InvitationNotifier } from './invitation-notifier.js';

/**
 * Somebody lost their passkey and asked for a new setup link.
 *
 * The flow this replaces asked them to present the passkey they had just lost,
 * which is useless in exactly the situation it existed for.
 *
 * **This is weaker than enrolment and deliberately so.** First enrolment
 * requires a second channel — in person, or a value only the person and their
 * HR team know — because SP 800-63B-4 deprecates email and
 * `docs/auth-administration.md` sets out why. Recovery is answered with a link
 * to an email address, so whoever holds that mailbox can take the account. That
 * trade was made knowingly; `identity.account.recovered` is a separate event so
 * the weaker path stays countable.
 *
 * What is preserved: the link is single-use, expires like any other, and is
 * only ever sent to the address already on the account. Nothing here lets a
 * caller choose where it goes.
 */
export interface RecoverAccountRequest {
  readonly tenantId: string;
  /** As typed. Normalised here, and only ever matched — never used as a destination. */
  readonly workEmail: string;
}

export interface RecoverScope {
  readonly findByEmail: (email: string) => Promise<{
    accountId: string;
    identityId: string;
    status: string;
  } | null>;
  /**
   * Mints a fresh link and records that recovery was asked for.
   *
   * One operation, like `invite`, and for the same reason: the event carries
   * the token's expiry, so a caller able to do one without the other could
   * issue a link nobody recorded issuing.
   */
  readonly reissue: (accountId: string) => Promise<{ token: string; expiresAt: string }>;
}

export interface RecoverAccountDeps {
  readonly tenantById: (tenantId: string) => Promise<{
    slug: string;
    displayName: string;
    logoUrl: string | null;
  } | null>;
  readonly inTenantTransaction: <T>(
    tenantId: string,
    fn: (scope: RecoverScope) => Promise<T>,
  ) => Promise<T>;
  readonly authOrigin: string;
  readonly clock: Clock;
  readonly notifier?: InvitationNotifier | undefined;
  /** For the log. Never for the caller — see the return type. */
  readonly onRefusal?: (reason: string) => void;
}

/**
 * Always succeeds, and returns nothing.
 *
 * An unknown address, an address at another company, a suspended account and a
 * genuine recovery are one answer: "if that address has an account, a link is on
 * its way". Anything else is an oracle for whether a given person works at a
 * given company, which is the question this whole system is arranged not to
 * answer — see `resolveTenant` and `signIn`, which refuse it the same way.
 *
 * The reason goes to the log, where somebody who is allowed to know can read it.
 */
export type RecoverAccount = (request: RecoverAccountRequest) => Promise<void>;

export function recoverAccount(deps: RecoverAccountDeps): RecoverAccount {
  return async (request) => {
    const email = normaliseWorkEmail(request.workEmail);
    if (email === '') {
      deps.onRefusal?.('empty-address');
      return;
    }

    const tenant = await deps.tenantById(request.tenantId);
    if (tenant === null) {
      deps.onRefusal?.('unknown-tenant');
      return;
    }

    const sent = await deps.inTenantTransaction(request.tenantId, async (scope) => {
      const account = await scope.findByEmail(email);
      if (account === null) {
        deps.onRefusal?.('no-account');
        return null;
      }

      const allowed = mayRecover(account.status);
      if (!allowed.ok) {
        deps.onRefusal?.(allowed.error.code);
        return null;
      }

      const { token, expiresAt } = await scope.reissue(account.accountId);
      const link = enrolmentLink({
        authOrigin: deps.authOrigin,
        identityId: account.identityId,
        slug: tenant.slug,
        token,
        workEmail: email,
      });
      if (!link.ok) {
        deps.onRefusal?.(link.error.code);
        return null;
      }

      return { enrolUrl: link.value, expiresAt };
    });

    if (sent === null) return;

    /*
     * Sent outside the transaction, deliberately.
     *
     * A message is not rolled back. Holding the transaction open across an HTTP
     * call to another service also holds a row-level-security-scoped connection
     * for as long as that service takes to answer, which is the shape that
     * exhausts a pool under load.
     */
    await deps.notifier?.send({
      tenantId: request.tenantId,
      companyName: tenant.displayName,
      email,
      enrolUrl: sent.enrolUrl,
      expiresAt: sent.expiresAt,
      logoUrl: tenant.logoUrl,
    });
  };
}
