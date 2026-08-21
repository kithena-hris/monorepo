import type { VerifiedAssertion } from '../domain/credential.js';

/**
 * The WebAuthn library, as a port.
 *
 * Everything here is cryptography and CBOR parsing that nobody should
 * hand-roll, and all of it is replaceable. Behind this interface the domain
 * rules — clone detection, user verification, the tenant's authenticator policy
 * — are testable without generating a real attestation, which is the difference
 * between a suite that runs in milliseconds and one that needs a browser.
 */
export interface RegistrationRequest {
  readonly identityId: string;
  readonly displayName: string;
  /** Credential ids the browser should refuse to register again. */
  readonly excludeCredentialIds: readonly string[];
  readonly requireHardwareBound: boolean;
}

export interface RegistrationVerdict {
  readonly credentialId: string;
  /**
   * `Uint8Array<ArrayBuffer>`, not the looser `Uint8Array`.
   *
   * The default parameter is `ArrayBufferLike`, which admits
   * `SharedArrayBuffer` — memory another thread can mutate while a signature is
   * being checked against it. Narrowing here is also what lets the adapter hand
   * this straight to the library without an assertion.
   */
  readonly publicKey: Uint8Array<ArrayBuffer>;
  readonly signCount: number;
  readonly aaguid: string;
  readonly backedUp: boolean;
  readonly userVerified: boolean;
}

export interface AssertionVerdict extends VerifiedAssertion {
  readonly credentialId: string;
}

export interface StoredCredential {
  readonly externalId: string;
  readonly publicKey: Uint8Array<ArrayBuffer>;
  readonly signCount: number;
}

export interface RelyingParty {
  beginRegistration(request: RegistrationRequest): Promise<{ options: unknown; challenge: string }>;
  finishRegistration(
    response: unknown,
    expected: { challenge: string; origin: string },
  ): Promise<RegistrationVerdict>;

  beginAuthentication(): Promise<{ options: unknown; challenge: string }>;
  finishAuthentication(
    response: unknown,
    expected: { challenge: string; origin: string; credential: StoredCredential },
  ): Promise<AssertionVerdict>;
}
