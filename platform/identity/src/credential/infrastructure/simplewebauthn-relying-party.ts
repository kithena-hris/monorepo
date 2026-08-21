import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';

import type { RelyingParty } from '../application/relying-party.js';

/**
 * The ceremonies, delegated.
 *
 * CBOR decoding, COSE key parsing, attestation statement formats and signature
 * verification across five authenticator families. None of it should be
 * hand-written, and all of it is behind the `RelyingParty` port so the rules
 * that *are* ours stay testable without generating a real attestation.
 *
 * What this file decides is only what to ask the browser for.
 */
export interface RelyingPartyConfig {
  /** `app.kithena.com`. Every acceptable origin ends in it. */
  readonly rpId: string;
  readonly rpName: string;
}

export function simpleWebAuthnRelyingParty(config: RelyingPartyConfig): RelyingParty {
  return {
    async beginRegistration(request) {
      const options = await generateRegistrationOptions({
        rpID: config.rpId,
        rpName: config.rpName,
        // The opaque identity id, never an email or an employee number. This
        // value is stored in plain text on the authenticator and syncs to the
        // vendor's cloud, so anything meaningful here leaks the employment
        // relationship to whoever dumps a synced keychain.
        userID: new TextEncoder().encode(request.identityId),
        userName: request.displayName,
        // What the credential list shows. Deliberately the product name and not
        // the tenant's: one passkey serves every employer, and labelling it with
        // one of them would be wrong at the other two.
        userDisplayName: request.displayName,
        // `none`. Attestation identifies the authenticator model, which is a
        // privacy cost paid on every registration, and it is only worth paying
        // for a tenant that has asked to restrict models.
        attestationType: request.requireHardwareBound ? 'direct' : 'none',
        excludeCredentials: request.excludeCredentialIds.map((id) => ({ id })),
        authenticatorSelection: {
          // Discoverable, so signing in is a tap rather than a tap preceded by
          // typing an email nobody should have to remember.
          residentKey: 'required',
          // Required, not preferred. Without it a passkey is single factor:
          // possession of an unlocked device and nothing more.
          userVerification: 'required',
        },
      });

      return { options, challenge: options.challenge };
    },

    async finishRegistration(response, expected) {
      const verification = await verifyRegistrationResponse({
        response: response as never,
        expectedChallenge: expected.challenge,
        expectedOrigin: expected.origin,
        expectedRPID: config.rpId,
        requireUserVerification: true,
      });

      const info = verification.registrationInfo;
      if (!verification.verified || !info) throw new Error('Registration could not be verified');

      return {
        credentialId: info.credential.id,
        publicKey: info.credential.publicKey,
        signCount: info.credential.counter,
        aaguid: info.aaguid,
        backedUp: info.credentialBackedUp,
        userVerified: true,
      };
    },

    async beginAuthentication() {
      const options = await generateAuthenticationOptions({
        rpID: config.rpId,
        userVerification: 'required',
        // No `allowCredentials`. Sending a list would tell an unauthenticated
        // caller which credentials exist for an account, which is an account
        // enumeration oracle; discoverable credentials make the list
        // unnecessary anyway.
      });

      return { options, challenge: options.challenge };
    },

    async finishAuthentication(response, expected) {
      const verification = await verifyAuthenticationResponse({
        response: response as never,
        expectedChallenge: expected.challenge,
        expectedOrigin: expected.origin,
        expectedRPID: config.rpId,
        requireUserVerification: true,
        credential: {
          id: expected.credential.externalId,
          publicKey: expected.credential.publicKey,
          counter: expected.credential.signCount,
        },
      });

      if (!verification.verified) throw new Error('Assertion could not be verified');

      return {
        credentialId: expected.credential.externalId,
        newSignCount: verification.authenticationInfo.newCounter,
        userVerified: verification.authenticationInfo.userVerified,
        backedUp: verification.authenticationInfo.credentialBackedUp,
      };
    },
  };
}
