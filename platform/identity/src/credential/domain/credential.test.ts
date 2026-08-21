import { describe, expect, it } from 'vitest';

import {
  acceptAssertion,
  isCloned,
  type Credential,
  type VerifiedAssertion,
} from './credential.js';

/**
 * What a valid signature does not prove.
 *
 * Every case here starts from an assertion the library has already verified
 * cryptographically. The question each one asks is whether a correct signature
 * should nonetheless be refused, and the answer is yes more often than is
 * comfortable.
 */

const credential = (over: Partial<Credential> = {}): Credential => ({
  id: '00000000-0000-4000-8000-0000000000f1',
  identityId: '00000000-0000-4000-8000-0000000000d1',
  kind: 'passkey',
  externalId: 'Y3JlZC1pZA',
  provider: '00000000-0000-0000-0000-000000000000',
  signCount: 0,
  backedUp: true,
  revokedAt: null,
  ...over,
});

const assertion = (over: Partial<VerifiedAssertion> = {}): VerifiedAssertion => ({
  newSignCount: 0,
  userVerified: true,
  backedUp: true,
  ...over,
});

describe('isCloned', () => {
  it('accepts a counter that advanced', () => {
    expect(isCloned(41, 42)).toBe(false);
  });

  it('rejects a counter that stood still', () => {
    // Two authenticators answering for one credential. The signature is valid
    // because the private key was copied.
    expect(isCloned(42, 42)).toBe(true);
  });

  it('rejects a counter that went backwards', () => {
    expect(isCloned(42, 7)).toBe(true);
  });

  it('accepts zero to zero, because that is what a synced passkey reports', () => {
    // The case that matters most in practice and looks most like a clone.
    // Platform authenticators that back up to a vendor cloud always report
    // zero, because a counter cannot be kept consistent across syncing devices.
    // A naive `new <= old` here rejects the majority of real passkeys.
    expect(isCloned(0, 0)).toBe(false);
  });

  it('still rejects a counter that falls back to zero after counting', () => {
    // An authenticator that was counting and then reports zero is not a synced
    // passkey that never counted. It is the interesting case.
    expect(isCloned(42, 0)).toBe(true);
  });
});

describe('acceptAssertion', () => {
  it('accepts a well-behaved assertion and hands back what to store', () => {
    const result = acceptAssertion(credential({ signCount: 4 }), assertion({ newSignCount: 5 }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.signCount).toBe(5);
  });

  it('refuses a revoked credential however valid the signature', () => {
    // Revocation is the whole point of being able to remove a passkey. A
    // verified assertion from a removed credential is still verified.
    const result = acceptAssertion(
      credential({ revokedAt: '2026-04-01T00:00:00.000Z' }),
      assertion(),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('CREDENTIAL_REVOKED');
  });

  it('refuses an assertion that only proves presence', () => {
    // Without user verification a passkey is single factor: possession of an
    // unlocked device, with no evidence anyone was asked for anything.
    const result = acceptAssertion(credential(), assertion({ userVerified: false }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('USER_VERIFICATION_REQUIRED');
  });

  it('refuses a synced passkey when the tenant demands hardware-bound', () => {
    const result = acceptAssertion(credential(), assertion({ backedUp: true }), {
      hardwareBoundOnly: true,
      requireUserVerification: true,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('HARDWARE_BOUND_REQUIRED');
  });

  it('accepts a device-bound authenticator under the same policy', () => {
    const result = acceptAssertion(credential(), assertion({ backedUp: false }), {
      hardwareBoundOnly: true,
      requireUserVerification: true,
    });
    expect(result.ok).toBe(true);
  });

  it('refuses a cloned authenticator', () => {
    const result = acceptAssertion(credential({ signCount: 9 }), assertion({ newSignCount: 9 }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('AUTHENTICATOR_CLONED');
  });

  it('checks revocation before anything else', () => {
    // A revoked credential that is also cloned and unverified should report
    // revocation. The order is what a support agent reads first, and "this
    // passkey was removed" is more useful than "the counter went backwards".
    const result = acceptAssertion(
      credential({ revokedAt: '2026-04-01T00:00:00.000Z', signCount: 9 }),
      assertion({ newSignCount: 1, userVerified: false }),
    );
    if (result.ok) return;
    expect(result.error.code).toBe('CREDENTIAL_REVOKED');
  });

  it('records the backup state each time, because it can change', () => {
    // A passkey created on one device and later synced flips `backedUp` from
    // false to true. Storing it once at registration would leave a tenant that
    // later turns on hardware-bound enforcement checking a stale value.
    const result = acceptAssertion(
      credential({ backedUp: false, signCount: 1 }),
      assertion({ backedUp: true, newSignCount: 2 }),
    );
    if (!result.ok) return;
    expect(result.value.backedUp).toBe(true);
  });
});
