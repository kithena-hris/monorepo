import { describe, expect, it } from 'vitest';
import { createLocalJWKSet, decodeProtectedHeader, jwtVerify } from 'jose';
import { fixedClock } from '@kithena/domain-kit';

import { mintToken } from '../application/mint-token.js';
import { principalFrom } from '../domain/principal.js';
import { developmentKey, joseSigner } from './jose-signer.js';

/**
 * A token, and the JWKS a module would verify it against.
 *
 * This is the whole contract between identity and every other service. A module
 * never calls this service — it fetches a public key and checks a signature,
 * which is what keeps `just standalone <module>` true and what lets a customer
 * point a module at their own issuer instead. So the test verifies the way a
 * module would, rather than asserting on the string.
 */

const session = {
  sessionId: '00000000-0000-4000-8000-0000000000b1',
  accountId: '00000000-0000-4000-8000-0000000000a1',
  tenantId: '00000000-0000-4000-8000-00000000000a',
  identityId: '00000000-0000-4000-8000-0000000000d1',
  amr: ['swk', 'user'],
  authenticatedAt: '2026-04-01T09:00:00.000Z',
  expiresAt: '2026-05-01T09:00:00.000Z',
  lastSeenAt: '2026-04-01T09:00:00.000Z',
};

const ISSUER = 'https://auth.app.kithena.com';
const AUDIENCE = 'kithena-router';
const clock = fixedClock('2026-04-01T10:00:00.000Z');

async function subject() {
  const signer = await joseSigner(await developmentKey());
  const mint = mintToken({ signer, clock, issuer: ISSUER, audience: AUDIENCE });
  return { signer, mint };
}

describe('a minted token', () => {
  it('verifies against the published JWKS', async () => {
    const { signer, mint } = await subject();

    const token = await mint(principalFrom(session));
    const { payload } = await jwtVerify(token, createLocalJWKSet(signer.jwks()), {
      issuer: ISSUER,
      audience: AUDIENCE,
      // Verified at the instant it was minted. The clock is fixed so that the
      // claims are deterministic, and without this jose would check `exp`
      // against the wall clock and reject a token that is correct.
      currentDate: clock.now(),
    });

    expect(payload['sub']).toBe(session.accountId);
    expect(payload['tid']).toBe(session.tenantId);
    expect(payload['amr']).toEqual(['swk', 'user']);
    expect(payload['auth_time']).toBe(Date.parse(session.authenticatedAt) / 1000);
  });

  it('expires two minutes after it is minted', async () => {
    // Short on purpose. A session is a row that can be deleted; this is a
    // bearer token that cannot be recalled once handed out, so the window in
    // which a revoked session still works is exactly this number.
    const { mint } = await subject();
    const claims = claimsOf(await mint(principalFrom(session)));
    expect(Number(claims['exp']) - Number(claims['iat'])).toBe(120);
  });

  it('is refused by a module holding a different key', async () => {
    // The signature is the whole contract. A token from an issuer a module has
    // not been told to trust must fail, not merely look wrong.
    const { mint } = await subject();
    const stranger = await joseSigner(await developmentKey());

    await expect(
      jwtVerify(await mint(principalFrom(session)), createLocalJWKSet(stranger.jwks()), {
        issuer: ISSUER,
        audience: AUDIENCE,
        currentDate: clock.now(),
      }),
    ).rejects.toThrow();
  });

  it('carries no identity id', async () => {
    // The one value linking a human across employers. In a token every module
    // can read, it would tell Acme's subgraph that this person also works for
    // Globex.
    const { mint } = await subject();
    const token = await mint(principalFrom(session));
    expect(token).not.toContain(Buffer.from(session.identityId).toString('base64url'));
    const [, body] = token.split('.');
    expect(Buffer.from(body ?? '', 'base64url').toString()).not.toContain(session.identityId);
  });

  it('omits the actor claim unless someone is impersonating', async () => {
    const { mint } = await subject();

    const plain = await mint(principalFrom(session));
    const acting = await mint(
      principalFrom(session, { by: '00000000-0000-4000-8000-0000000000c9' }),
    );

    expect(claimsOf(plain)['act']).toBeUndefined();
    expect(claimsOf(acting)['act']).toEqual({ sub: '00000000-0000-4000-8000-0000000000c9' });
  });

  it('is labelled with the key that signed it', async () => {
    const { signer, mint } = await subject();
    const header = decodeProtectedHeader(await mint(principalFrom(session)));
    const [published] = signer.jwks().keys;
    expect(header.kid).toBe(published?.kid);
    expect(header.typ).toBe('at+jwt');
  });
});

describe('the published JWKS', () => {
  it('contains no private component', async () => {
    // The failure this exists to prevent is publishing `d` at a URL whose
    // entire purpose is being fetched by strangers. Asserted over the
    // serialised form, so a key type with a differently named private field
    // fails here too.
    const { signer } = await subject();
    const serialised = JSON.stringify(signer.jwks());

    for (const secret of ['"d"', '"p"', '"q"', '"dp"', '"dq"', '"qi"']) {
      expect(serialised, `${secret} must never be published`).not.toContain(secret);
    }
  });

  it('publishes a key a module can actually use', async () => {
    const { signer } = await subject();
    const [key] = signer.jwks().keys;
    expect(key?.use).toBe('sig');
    expect(key?.alg).toBe('ES256');
    expect(key?.kty).toBe('EC');
  });
});

function claimsOf(token: string): Record<string, unknown> {
  const [, body] = token.split('.');
  return JSON.parse(Buffer.from(body ?? '', 'base64url').toString()) as Record<string, unknown>;
}
