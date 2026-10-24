import { createSign, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { endedSpace, googlePushVerifier } from './google-push.js';

/** Pub/Sub's push tokens: only Google's, for this endpoint and Kithena's push account, in date. */
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1' };
const AUDIENCE = 'https://app.kithena.com/api/hooks/google-meet';
const ACCOUNT = 'meet-events-push@kithena.iam.gserviceaccount.com';
const NOW = 1_800_000_000_000;

const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
function token(claims: Record<string, unknown>, kid = 'k1'): string {
  const unsigned = `${b64({ alg: 'RS256', kid })}.${b64({
    iss: 'https://accounts.google.com',
    aud: AUDIENCE,
    email: ACCOUNT,
    email_verified: true,
    exp: NOW / 1000 + 600,
    ...claims,
  })}`;
  return `Bearer ${unsigned}.${createSign('RSA-SHA256').update(unsigned).sign(privateKey, 'base64url')}`;
}

const proved = googlePushVerifier({
  audience: AUDIENCE,
  account: ACCOUNT,
  now: () => NOW,
  certs: () => Promise.resolve({ keys: [jwk] }),
});

describe('a push from Pub/Sub', () => {
  it('is Google’s, for this endpoint and the push account, and in date', async () => {
    expect(await proved(token({}))).toBe(true);
    expect(await proved(token({ aud: 'https://elsewhere.example' }))).toBe(false);
    expect(await proved(token({ email: 'someone@example.com' }))).toBe(false);
    expect(await proved(token({ exp: NOW / 1000 - 1 }))).toBe(false);
    expect(await proved(token({}, 'unknown'))).toBe(false);
    expect(await proved(undefined)).toBe(false);
    expect(await proved(`${token({}).slice(0, -4)}AAAA`)).toBe(false);
  });

  it('names the Meet space whose call ended, and nothing for any other event', () => {
    const push = (type: string, subject: string) =>
      JSON.stringify({ message: { attributes: { 'ce-type': type, 'ce-subject': subject } } });
    expect(
      endedSpace(
        push('google.workspace.meet.conference.v2.ended', '//meet.googleapis.com/spaces/abc'),
      ),
    ).toBe('spaces/abc');
    expect(
      endedSpace(
        push('google.workspace.meet.conference.v2.started', '//meet.googleapis.com/spaces/abc'),
      ),
    ).toBeNull();
    expect(endedSpace('not json')).toBeNull();
  });
});
