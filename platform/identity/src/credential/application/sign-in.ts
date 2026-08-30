import { err, failure, ok, type Result } from '@kithena/domain-kit';

import type { Device } from '../../shared/device.js';
import { chooseAccount, type AccountCandidate } from '../domain/account-choice.js';
import type { SignInWithPasskey } from './sign-in-with-passkey.js';

/**
 * A passkey, all the way to a session.
 *
 * The two halves of a sign-in, joined. The passkey answers "who is this
 * human", globally. The account lookup answers "may they act at this company",
 * and it is a separate question with a separate answer — a perfectly valid
 * passkey belonging to somebody with no account here finds nothing, which is
 * what commissioning means in practice.
 *
 * The account side arrives as two functions rather than as an import. That is
 * not ceremony: `no-cross-slice-imports` forbids this slice reaching into the
 * account slice, and it is right to. This states what it needs, `main.ts`
 * supplies it, and the credential slice stays testable with two stubs.
 */
export interface StartedSession {
  readonly sessionId: string;
  readonly accountId: string;
  readonly expiresAt: string;
}

/**
 * Where the person ended up, so the caller can send them there.
 *
 * The slug travels because the sign-in page no longer knows it: on the generic
 * page nobody named a company, and the answer is only known once the passkey
 * has said who this is.
 */
export interface SignedIn extends StartedSession {
  readonly tenantId: string;
  readonly tenantSlug: string;
}

export interface SignInDeps {
  readonly verify: SignInWithPasskey;
  /**
   * Every usable account this human holds, across companies.
   *
   * Broader than the question it replaces — "the account at *this* company" —
   * because the company is no longer known when the ceremony starts. Narrowing
   * is `chooseAccount`'s job and happens after the passkey has been verified,
   * so an unauthenticated caller never learns anything from it.
   */
  readonly accountsFor: (identityId: string) => Promise<readonly AccountCandidate[]>;
  readonly beginSession: (
    tenantId: string,
    accountId: string,
    device: Device,
    amr: readonly string[],
  ) => Promise<Result<StartedSession>>;
  readonly onRefusal?: (reason: string) => void;
}

export interface SignInRequest {
  /** Named by the branded per-company page. Absent on the generic one. */
  readonly tenantId?: string | undefined;
  /** Typed on the generic page. Absent on the branded one. */
  readonly workEmail?: string | undefined;
  readonly response: unknown;
  readonly origin: string;
  readonly challenge: string;
  readonly device: Device;
}

/**
 * One refusal for everything.
 *
 * A caller cannot tell a wrong passkey from a valid passkey with no account
 * here, and that is deliberate: the second would otherwise let anyone with a
 * passkey ask "does this person work at Acme" and get a straight answer.
 */
const Refused = failure('SIGN_IN_FAILED', 'Could not sign in');

export type SignIn = (request: SignInRequest) => Promise<Result<SignedIn>>;

export function signIn({ verify, accountsFor, beginSession, onRefusal }: SignInDeps): SignIn {
  return async (request) => {
    const credential = await verify({
      response: request.response,
      origin: request.origin,
      challenge: request.challenge,
    });
    if (!credential.ok) {
      onRefusal?.('credential');
      return err(Refused);
    }

    // The commissioning rule, enforced. Not "create one", not "ask HR" — a
    // refusal, indistinguishable from a bad passkey.
    const chosen = chooseAccount(await accountsFor(credential.value.identityId), {
      tenantId: request.tenantId,
      workEmail: request.workEmail,
    });
    if (!chosen.ok) {
      onRefusal?.('no-account');
      return err(Refused);
    }

    // `amr` per RFC 8176: a hardware or software key, plus user verification.
    // The domain already refused an assertion without it, so recording `user`
    // here is a statement of what happened rather than a hopeful default.
    const started = await beginSession(
      chosen.value.tenantId,
      chosen.value.accountId,
      request.device,
      ['swk', 'user'],
    );
    if (!started.ok) {
      onRefusal?.(started.error.code);
      return err(Refused);
    }

    return ok({
      ...started.value,
      tenantId: chosen.value.tenantId,
      tenantSlug: chosen.value.tenantSlug,
    });
  };
}
