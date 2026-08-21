import { err, failure, ok, type DomainFailure, type Result } from '@kithena/domain-kit';

/**
 * A passkey, and the checks a cryptographically valid assertion must still pass.
 *
 * The library verifies the signature. Everything here is what the signature
 * being valid does *not* tell you: whether the authenticator has been cloned,
 * whether a human was actually present, whether this credential is still
 * supposed to work, and whether it is the kind of authenticator this tenant
 * accepts. A verified assertion from a revoked credential is still a verified
 * assertion.
 */

export type CredentialKind = 'passkey' | 'federated' | 'password';

export interface Credential {
  readonly id: string;
  readonly identityId: string;
  readonly kind: CredentialKind;
  /** WebAuthn credential id, or the issuer's subject. */
  readonly externalId: string;
  /** AAGUID for a passkey, issuer for a federated link. */
  readonly provider: string;
  /** WebAuthn's replay counter, as last seen. */
  readonly signCount: number;
  /** Whether the authenticator can leave the device that created it. */
  readonly backedUp: boolean;
  readonly revokedAt: string | null;
}

/**
 * What a tenant will accept.
 *
 * `hardwareBoundOnly` is the setting regulated buyers ask for and nobody else
 * wants: it refuses synced passkeys, which is most of them, in exchange for
 * knowing the private key never left a device somebody can hold.
 */
export interface CredentialPolicy {
  readonly hardwareBoundOnly: boolean;
  /** Whether an assertion must carry proof a human was verified, not merely present. */
  readonly requireUserVerification: boolean;
}

export const defaultCredentialPolicy: CredentialPolicy = {
  hardwareBoundOnly: false,
  requireUserVerification: true,
};

/** What the library reports after checking the signature. */
export interface VerifiedAssertion {
  readonly newSignCount: number;
  readonly userVerified: boolean;
  readonly backedUp: boolean;
}

export const CredentialRevoked: DomainFailure = failure(
  'CREDENTIAL_REVOKED',
  'This credential is no longer valid',
);

export const CloneDetected: DomainFailure = failure(
  'AUTHENTICATOR_CLONED',
  'This authenticator reported a signature counter that went backwards',
);

export const UserVerificationRequired: DomainFailure = failure(
  'USER_VERIFICATION_REQUIRED',
  'This credential must verify the person, not merely their presence',
);

export const HardwareBoundRequired: DomainFailure = failure(
  'HARDWARE_BOUND_REQUIRED',
  'This company requires an authenticator whose key cannot leave the device',
);

/**
 * Accept an assertion, or say why not.
 *
 * Returns the counter to store, because the caller has to persist it and
 * forgetting to would silently disable clone detection for that credential
 * forever.
 */
export function acceptAssertion(
  credential: Credential,
  assertion: VerifiedAssertion,
  policy: CredentialPolicy = defaultCredentialPolicy,
): Result<{ signCount: number; backedUp: boolean }> {
  if (credential.revokedAt !== null) return err(CredentialRevoked);

  if (policy.requireUserVerification && !assertion.userVerified) {
    // Without this a passkey is single-factor: possession of an unlocked
    // device, with no evidence anyone was asked for a fingerprint or a PIN.
    return err(UserVerificationRequired);
  }

  if (policy.hardwareBoundOnly && assertion.backedUp) {
    return err(HardwareBoundRequired);
  }

  if (isCloned(credential.signCount, assertion.newSignCount)) return err(CloneDetected);

  return ok({ signCount: assertion.newSignCount, backedUp: assertion.backedUp });
}

/**
 * Whether the counter says the authenticator has been copied.
 *
 * WebAuthn's counter increments on every assertion, so a value that does not
 * advance means two authenticators are answering for one credential — the
 * signature is valid because the private key was copied.
 *
 * **Both counters at zero is the normal case, not a clone.** Syncable passkeys
 * — every platform authenticator that backs up to a vendor cloud — report zero
 * always, because a counter cannot be kept consistent across devices that sync.
 * Treating that as a clone would reject the majority of real passkeys, which is
 * why this check is written around the zero case rather than as `new <= old`.
 */
export function isCloned(storedSignCount: number, newSignCount: number): boolean {
  if (storedSignCount === 0 && newSignCount === 0) return false;
  return newSignCount <= storedSignCount;
}
