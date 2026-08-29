import { describe, expect, it } from 'vitest';
import { err, ok, failure } from '@kithena/domain-kit';

import type { Credential } from '../domain/credential.js';
import { signIn, type SignInDeps } from './sign-in.js';

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

const started = {
  sessionId: '00000000-0000-4000-8000-0000000000b1',
  accountId: '00000000-0000-4000-8000-0000000000a1',
  expiresAt: '2026-05-01T09:00:00.000Z',
};

function deps(over: Partial<SignInDeps> = {}): SignInDeps & { refusals: string[] } {
  const refusals: string[] = [];
  return {
    refusals,
    verify: () => Promise.resolve(ok(credential)),
    accountsFor: () =>
      Promise.resolve([
        {
          accountId: started.accountId,
          tenantId: request.tenantId,
          tenantSlug: 'acme',
          workEmail: 'ada.lovelace@acme.example',
        },
      ]),
    beginSession: () => Promise.resolve(ok(started)),
    onRefusal: (reason) => refusals.push(reason),
    ...over,
  };
}

const request = {
  tenantId: '00000000-0000-4000-8000-00000000000a',
  response: { id: 'cred-1' },
  origin: 'https://acme.app.kithena.com',
  challenge: 'chal-1',
  device: { ip: '203.0.113.7', userAgent: 'test', aaguid: null },
};

describe('signIn', () => {
  it('turns a good passkey into a session', async () => {
    const result = await signIn(deps())(request);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sessionId).toBe(started.sessionId);
  });

  it('refuses a valid passkey with no account at this company', async () => {
    // Commissioning, enforced. A perfectly valid passkey belonging to somebody
    // this customer has never hired gets a refusal, not an account.
    const d = deps({ accountsFor: () => Promise.resolve([]) });

    expect((await signIn(d)(request)).ok).toBe(false);
    expect(d.refusals).toEqual(['no-account']);
  });

  it('never asks about an account when the passkey itself failed', async () => {
    // An unauthenticated caller must not be able to reach the account lookup
    // by presenting a passkey that does not verify.
    let asked = 0;
    const d = deps({
      verify: () => Promise.resolve(err(failure('AUTHENTICATION_FAILED', 'no'))),
      accountsFor: () => {
        asked += 1;
        return Promise.resolve([]);
      },
    });

    expect((await signIn(d)(request)).ok).toBe(false);
    expect(asked).toBe(0);
  });

  it('tells a bad passkey and an absent account apart only in the log', async () => {
    // Otherwise anyone holding a passkey could ask "does this person work at
    // Acme" and get a straight answer.
    const badKey = deps({
      verify: () => Promise.resolve(err(failure('AUTHENTICATION_FAILED', 'no'))),
    });
    const noAccount = deps({ accountsFor: () => Promise.resolve([]) });

    const a = await signIn(badKey)(request);
    const b = await signIn(noAccount)(request);
    if (a.ok || b.ok) throw new Error('both should refuse');

    expect(a.error).toEqual(b.error);
    expect(badKey.refusals).not.toEqual(noAccount.refusals);
  });

  it('surfaces a session that could not be started as the same refusal', async () => {
    // A suspended account reaches here with a valid passkey and a real account
    // row. It still gets nothing, and the reason goes to the log.
    const d = deps({
      beginSession: () => Promise.resolve(err(failure('INVALID_TRANSITION', 'suspended'))),
    });

    expect((await signIn(d)(request)).ok).toBe(false);
    expect(d.refusals).toEqual(['INVALID_TRANSITION']);
  });

  it('records that a key and a person were both verified', async () => {
    let recorded: readonly string[] = [];
    const d = deps({
      beginSession: (_t, _a, _d, amr) => {
        recorded = amr;
        return Promise.resolve(ok(started));
      },
    });

    await signIn(d)(request);

    expect(recorded).toEqual(['swk', 'user']);
  });
});
