import { describe, expect, it } from 'vitest';

import { softwareAuthenticator } from '../testing/software-authenticator.js';
import { simpleWebAuthnRelyingParty } from './simplewebauthn-relying-party.js';

/**
 * The two verification behaviours SimpleWebAuthn 14 changed under us, pinned
 * against the real library with a software key. No database: these are
 * properties of the adapter alone.
 */
const RP_ID = 'app.kithena.com';
const ORIGIN = 'https://acme.app.kithena.com';

const rp = simpleWebAuthnRelyingParty({ rpId: RP_ID, rpName: 'Kithena' });
const authenticator = softwareAuthenticator('adapter-passkey');
const credential = {
  externalId: authenticator.credentialId,
  publicKey: authenticator.cosePublicKey,
  signCount: 0,
};

describe('the SimpleWebAuthn adapter', () => {
  it('offers the same three algorithms whatever the runtime supports', async () => {
    // v14 prepends ML-DSA-44 to its default when Node can verify it.
    const { options } = await rp.beginRegistration({
      identityId: 'identity',
      displayName: 'Ada',
      excludeCredentialIds: [],
      requireHardwareBound: false,
    });

    const offered = (options as { pubKeyCredParams: { alg: number }[] }).pubKeyCredParams;
    expect(offered.map((param) => param.alg)).toEqual([-8, -7, -257]);
  });

  it('accepts a same-origin assertion', async () => {
    const { challenge } = await rp.beginAuthentication();
    const assertion = authenticator.assert({
      challenge,
      origin: ORIGIN,
      rpId: RP_ID,
      signCount: 1,
    });

    const verdict = await rp.finishAuthentication(assertion, {
      challenge,
      origin: ORIGIN,
      credential,
    });
    expect(verdict.userVerified).toBe(true);
    expect(verdict.newSignCount).toBe(1);
  });

  it('refuses an assertion made inside another site’s iframe', async () => {
    // Origin, RP ID, signature and challenge all check out. Only the client
    // data says the ceremony ran framed by somebody else's page, and v13
    // never looked at that.
    const { challenge } = await rp.beginAuthentication();
    const assertion = authenticator.assert({
      challenge,
      origin: ORIGIN,
      rpId: RP_ID,
      signCount: 1,
      topOrigin: 'https://evil.example',
    });

    await expect(
      rp.finishAuthentication(assertion, { challenge, origin: ORIGIN, credential }),
    ).rejects.toThrow(/cross-origin/);
  });
});
