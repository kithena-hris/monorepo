import { describe, expect, it } from 'vitest';

import type { Credential } from '../domain/credential.js';
import type { OriginPolicy } from '../../shared/origin.js';
import type { ChallengeStore } from './challenge-store.js';
import type { RelyingParty } from './relying-party.js';
import { signInWithPasskey, type SignInDeps } from './sign-in-with-passkey.js';

/**
 * Sign-in, with the cryptography stubbed and everything around it real.
 *
 * The library's job — checking a signature — is assumed to work. What is tested
 * is the order the checks run in, that a challenge is spent exactly once, and
 * that every refusal looks identical from outside.
 */

const ORIGINS: OriginPolicy = {
  rpId: 'app.kithena.com',
  authOrigin: 'https://auth.app.kithena.com',
};

const credential: Credential = {
  id: '00000000-0000-4000-8000-0000000000f1',
  identityId: '00000000-0000-4000-8000-0000000000d1',
  kind: 'passkey',
  externalId: 'cred-1',
  provider: '00000000-0000-0000-0000-000000000000',
  signCount: 4,
  backedUp: true,
  revokedAt: null,
};

function store(seeded: boolean): ChallengeStore & { consumed: number } {
  let live = seeded;
  const s = {
    consumed: 0,
    issue: () => Promise.resolve(),
    consume: () => {
      s.consumed += 1;
      if (!live) return Promise.resolve(null);
      live = false;
      return Promise.resolve({ purpose: 'authentication' as const, subject: null });
    },
  };
  return s;
}

function deps(
  over: Partial<SignInDeps> = {},
): SignInDeps & { refusals: string[]; recorded: unknown[] } {
  const refusals: string[] = [];
  const recorded: unknown[] = [];
  return {
    refusals,
    recorded,
    rp: {
      beginRegistration: () => Promise.reject(new Error('unused')),
      finishRegistration: () => Promise.reject(new Error('unused')),
      beginAuthentication: () => Promise.reject(new Error('unused')),
      finishAuthentication: () =>
        Promise.resolve({
          credentialId: 'cred-1',
          newSignCount: 5,
          userVerified: true,
          backedUp: true,
        }),
    } satisfies RelyingParty,
    challenges: store(true),
    credentials: {
      byExternalId: () => Promise.resolve(credential),
      publicKeyOf: () => Promise.resolve({ publicKey: new Uint8Array([1]), signCount: 4 }),
      recordUse: (id, state) => {
        recorded.push({ id, state });
        return Promise.resolve();
      },
    },
    origins: ORIGINS,
    policyFor: () => Promise.resolve({ hardwareBoundOnly: false, requireUserVerification: true }),
    onRefusal: (reason) => refusals.push(reason),
    ...over,
  };
}

const request = {
  response: { id: 'cred-1' },
  origin: 'https://acme.app.kithena.com',
  challenge: 'chal-1',
};

describe('signInWithPasskey', () => {
  it('accepts a good assertion and records the new counter', async () => {
    const d = deps();
    const result = await signInWithPasskey(d)(request);

    expect(result.ok).toBe(true);
    expect(d.recorded).toEqual([{ id: credential.id, state: { signCount: 5, backedUp: true } }]);
  });

  it('spends the challenge, so the same assertion cannot be replayed', async () => {
    // The captured-assertion attack. The signature verifies perfectly the
    // second time; the challenge is what makes it useless.
    const d = deps();
    const run = signInWithPasskey(d);

    expect((await run(request)).ok).toBe(true);
    expect((await run(request)).ok).toBe(false);
  });

  it('checks the origin before touching the credential store', async () => {
    // An origin nobody issued should never reach a lookup. Asserted by
    // counting: a rejected origin consumes no challenge.
    const challenges = store(true);
    const d = deps({ challenges });

    const result = await signInWithPasskey(d)({
      ...request,
      origin: 'https://acme.app.kithena.com.evil.com',
    });

    expect(result.ok).toBe(false);
    expect(challenges.consumed).toBe(0);
    expect(d.refusals).toEqual(['origin']);
  });

  it('refuses a registration challenge presented for a sign-in', async () => {
    const d = deps({
      challenges: {
        issue: () => Promise.resolve(),
        consume: () => Promise.resolve({ purpose: 'registration', subject: 'someone' }),
      },
    });
    expect((await signInWithPasskey(d)(request)).ok).toBe(false);
    expect(d.refusals).toEqual(['challenge']);
  });

  it('treats a bad signature as a refusal, not a fault', async () => {
    const d = deps({
      rp: {
        beginRegistration: () => Promise.reject(new Error('unused')),
        finishRegistration: () => Promise.reject(new Error('unused')),
        beginAuthentication: () => Promise.reject(new Error('unused')),
        finishAuthentication: () => Promise.reject(new Error('signature mismatch')),
      },
    });

    await expect(signInWithPasskey(d)(request)).resolves.toMatchObject({ ok: false });
    expect(d.refusals).toEqual(['signature']);
  });

  it('applies the domain rules after the signature verifies', async () => {
    const d = deps({
      credentials: {
        byExternalId: () => Promise.resolve({ ...credential, revokedAt: '2026-01-01T00:00:00Z' }),
        publicKeyOf: () => Promise.resolve({ publicKey: new Uint8Array([1]), signCount: 4 }),
        recordUse: () => Promise.resolve(),
      },
    });

    expect((await signInWithPasskey(d)(request)).ok).toBe(false);
    expect(d.refusals).toEqual(['CREDENTIAL_REVOKED']);
  });

  it('says the same thing to the caller however it failed', async () => {
    // A prober learns whether they succeeded and nothing else — not whether a
    // credential exists, not whether it was revoked, not whether the counter
    // looked wrong. The reasons go to the log.
    const unknown = deps({
      credentials: {
        byExternalId: () => Promise.resolve(null),
        publicKeyOf: () => Promise.resolve(null),
        recordUse: () => Promise.resolve(),
      },
    });
    const revoked = deps({
      credentials: {
        byExternalId: () => Promise.resolve({ ...credential, revokedAt: '2026-01-01T00:00:00Z' }),
        publicKeyOf: () => Promise.resolve({ publicKey: new Uint8Array([1]), signCount: 4 }),
        recordUse: () => Promise.resolve(),
      },
    });

    const a = await signInWithPasskey(unknown)(request);
    const b = await signInWithPasskey(revoked)(request);

    expect(a.ok).toBe(false);
    expect(b.ok).toBe(false);
    if (a.ok || b.ok) return;
    expect(a.error).toEqual(b.error);
    expect(unknown.refusals).not.toEqual(revoked.refusals);
  });

  it('does not record a use when the assertion was refused', async () => {
    const d = deps({
      rp: {
        beginRegistration: () => Promise.reject(new Error('unused')),
        finishRegistration: () => Promise.reject(new Error('unused')),
        beginAuthentication: () => Promise.reject(new Error('unused')),
        finishAuthentication: () =>
          Promise.resolve({
            credentialId: 'cred-1',
            newSignCount: 4,
            userVerified: true,
            backedUp: true,
          }),
      },
    });

    // Counter did not advance: a clone. Nothing should be persisted.
    expect((await signInWithPasskey(d)(request)).ok).toBe(false);
    expect(d.recorded).toEqual([]);
  });
});
