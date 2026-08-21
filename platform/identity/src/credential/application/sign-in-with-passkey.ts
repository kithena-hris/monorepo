import { err, failure, ok, type Result } from '@kithena/domain-kit';

import { acceptAssertion, type Credential, type CredentialPolicy } from '../domain/credential.js';
import { isAcceptableOrigin, type OriginPolicy } from '../domain/origin.js';
import type { ChallengeStore } from './challenge-store.js';
import type { RelyingParty } from './relying-party.js';

/**
 * Signing in with a passkey.
 *
 * The order of the checks is the design. Origin first, because it needs no
 * lookup and an origin we did not issue should never reach the credential
 * store. Challenge second, and consuming it is what makes the ceremony
 * single-use. Signature third, by the library. Domain rules last, because they
 * are the ones that ask what a valid signature does not answer.
 *
 * Nothing a caller receives distinguishes the failures. An attacker probing
 * this endpoint learns whether they succeeded and nothing else — not whether a
 * credential exists, not whether it was revoked, not whether the counter looked
 * wrong.
 */
const Refused = failure('AUTHENTICATION_FAILED', 'Could not sign in with that passkey');

export interface SignInDeps {
  readonly rp: RelyingParty;
  readonly challenges: ChallengeStore;
  readonly credentials: {
    byExternalId(externalId: string): Promise<Credential | null>;
    publicKeyOf(
      credentialId: string,
    ): Promise<{ publicKey: Uint8Array<ArrayBuffer>; signCount: number } | null>;
    recordUse(credentialId: string, state: { signCount: number; backedUp: boolean }): Promise<void>;
  };
  readonly origins: OriginPolicy;
  readonly policyFor: (identityId: string) => Promise<CredentialPolicy>;
  /** Failures are logged with a reason the caller never sees. */
  readonly onRefusal?: (reason: string) => void;
}

export interface SignInRequest {
  readonly response: unknown;
  readonly origin: string;
  /** The challenge, read out of the client data by the caller. */
  readonly challenge: string;
}

export type SignInWithPasskey = (request: SignInRequest) => Promise<Result<Credential>>;

export function signInWithPasskey({
  rp,
  challenges,
  credentials,
  origins,
  policyFor,
  onRefusal,
}: SignInDeps): SignInWithPasskey {
  const refuse = (reason: string): Result<Credential> => {
    onRefusal?.(reason);
    return err(Refused);
  };

  return async ({ response, origin, challenge }) => {
    if (!isAcceptableOrigin(origin, origins)) return refuse('origin');

    const issued = await challenges.consume(challenge);
    if (!issued || issued.purpose !== 'authentication') return refuse('challenge');

    const claimed = credentialIdOf(response);
    if (claimed === null) return refuse('malformed');

    const credential = await credentials.byExternalId(claimed);
    if (!credential) return refuse('unknown-credential');

    const stored = await credentials.publicKeyOf(credential.id);
    if (!stored) return refuse('no-public-key');

    let verdict;
    try {
      verdict = await rp.finishAuthentication(response, {
        challenge,
        origin,
        credential: { externalId: credential.externalId, ...stored },
      });
    } catch {
      // The library throws on a bad signature. That is a refusal, not a fault.
      return refuse('signature');
    }

    const accepted = acceptAssertion(credential, verdict, await policyFor(credential.identityId));
    if (!accepted.ok) return refuse(accepted.error.code);

    // Persisted before returning. Skipping it would silently disable clone
    // detection for this credential from here on.
    await credentials.recordUse(credential.id, accepted.value);

    return ok(credential);
  };
}

/** The credential id the browser says answered, without trusting anything else. */
function credentialIdOf(response: unknown): string | null {
  if (response === null || typeof response !== 'object') return null;
  const id: unknown = (response as { id?: unknown }).id;
  return typeof id === 'string' && id.length > 0 ? id : null;
}
