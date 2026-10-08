import { createHash, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { appSignIn, bindCode, openCode } from './app-sign-in';

const KEY = 'internal-token';
const verifier = randomBytes(32).toString('base64url');
const challenge = createHash('sha256').update(verifier).digest('base64url');

describe('appSignIn', () => {
  it('accepts the app scheme and Expo Go, with a challenge', () => {
    expect(appSignIn('kithena://signed-in', challenge)).toEqual({
      redirect: 'kithena://signed-in',
      challenge,
    });
    expect(appSignIn('exp://192.168.1.20:8081/--/signed-in', challenge)?.redirect).toBe(
      'exp://192.168.1.20:8081/--/signed-in',
    );
  });

  it('refuses a web address, which would carry the code to whoever owns it', () => {
    expect(appSignIn('https://evil.example/steal', challenge)).toBeNull();
    expect(appSignIn('javascript:alert(1)', challenge)).toBeNull();
  });

  it('refuses a missing or malformed challenge', () => {
    expect(appSignIn('kithena://signed-in', undefined)).toBeNull();
    expect(appSignIn('kithena://signed-in', 'short')).toBeNull();
    expect(appSignIn(undefined, challenge)).toBeNull();
  });
});

describe('bindCode and openCode', () => {
  it('give the code back to whoever holds the verifier', () => {
    expect(openCode(bindCode('abc', challenge, KEY), verifier, KEY)).toBe('abc');
  });

  it('give nothing to somebody who intercepted the redirect but has no verifier', () => {
    const bound = bindCode('abc', challenge, KEY);
    expect(openCode(bound, randomBytes(32).toString('base64url'), KEY)).toBeNull();
  });

  it('never carry the code in the clear, so it cannot be spent at /auth/callback instead', () => {
    const code = randomBytes(32).toString('base64url');
    expect(bindCode(code, challenge, KEY)).not.toContain(code);
  });

  it('give nothing for a code bound under another key or tampered with', () => {
    expect(openCode(bindCode('abc', challenge, 'other'), verifier, KEY)).toBeNull();
    const bound = Buffer.from(bindCode('abc', challenge, KEY), 'base64url');
    bound[13] = (bound[13] ?? 0) ^ 1;
    expect(openCode(bound.toString('base64url'), verifier, KEY)).toBeNull();
    expect(openCode('abc', verifier, KEY)).toBeNull();
    expect(openCode(bindCode('abc', challenge, KEY), 'short', KEY)).toBeNull();
  });
});
