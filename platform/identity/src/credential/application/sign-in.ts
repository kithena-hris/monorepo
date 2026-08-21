import { err, failure, ok, type Result } from '@kithena/domain-kit';

import type { Device } from '../../shared/device.js';
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

export interface SignInDeps {
  readonly verify: SignInWithPasskey;
  /** The account this human holds at this company, if it is usable. */
  readonly activeAccountFor: (tenantId: string, identityId: string) => Promise<string | null>;
  readonly beginSession: (
    tenantId: string,
    accountId: string,
    device: Device,
    amr: readonly string[],
  ) => Promise<Result<StartedSession>>;
  readonly onRefusal?: (reason: string) => void;
}

export interface SignInRequest {
  readonly tenantId: string;
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

export type SignIn = (request: SignInRequest) => Promise<Result<StartedSession>>;

export function signIn({ verify, activeAccountFor, beginSession, onRefusal }: SignInDeps): SignIn {
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

    const accountId = await activeAccountFor(request.tenantId, credential.value.identityId);
    if (accountId === null) {
      // The commissioning rule, enforced. Not "create one", not "ask HR" — a
      // refusal, indistinguishable from a bad passkey.
      onRefusal?.('no-account');
      return err(Refused);
    }

    // `amr` per RFC 8176: a hardware or software key, plus user verification.
    // The domain already refused an assertion without it, so recording `user`
    // here is a statement of what happened rather than a hopeful default.
    const started = await beginSession(request.tenantId, accountId, request.device, [
      'swk',
      'user',
    ]);
    if (!started.ok) {
      onRefusal?.(started.error.code);
      return err(Refused);
    }

    return ok(started.value);
  };
}
