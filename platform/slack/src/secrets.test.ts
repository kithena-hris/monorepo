import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { seal, signState, tokenKeyFrom, unseal, verifyState } from './secrets.js';

describe('the bot token', () => {
  it('is sealed so that only the key opens it, and tampering is refused', () => {
    const key = tokenKeyFrom(randomBytes(32).toString('base64'));
    const other = tokenKeyFrom(randomBytes(32).toString('base64'));
    if (key === null || other === null) throw new Error('keys');
    const sealed = seal(key, 'xoxb-secret');
    expect(sealed.toString('utf8')).not.toContain('xoxb');
    expect(unseal(key, sealed)).toBe('xoxb-secret');
    expect(() => unseal(other, sealed)).toThrow();
    sealed.writeUInt8((sealed.at(-1) ?? 0) ^ 1, sealed.length - 1);
    expect(() => unseal(key, sealed)).toThrow();
    expect(tokenKeyFrom('short')).toBe(null);
  });
});

describe('the state', () => {
  const secret = randomBytes(32);
  const claims = { t: 'tenant', a: 'admin', o: 'https://acme.app.kithena.com' };

  it('comes back as it went, for ten minutes', () => {
    const state = signState(secret, claims, 1000);
    expect(verifyState(secret, state, 1000 + 60_000)).toMatchObject(claims);
    expect(verifyState(secret, state, 1000 + 11 * 60_000)).toBe(null);
  });

  it('is refused when anything in it was changed', () => {
    const state = signState(secret, claims, 1000);
    const [, sig] = state.split('.');
    const forged = `${Buffer.from(JSON.stringify({ ...claims, t: 'other', e: 9e15 })).toString('base64url')}.${sig ?? ''}`;
    expect(verifyState(secret, forged, 1000)).toBe(null);
    expect(verifyState(randomBytes(32), state, 1000)).toBe(null);
  });
});
