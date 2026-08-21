import { describe, expect, it } from 'vitest';

import { challengeFrom } from './client-data.js';

/**
 * Parsing bytes a stranger sent.
 *
 * This runs before any signature has been checked, on whatever the network
 * delivered. Every case is something that must produce null rather than an
 * exception, because an exception here is a 500 that tells the sender their
 * input reached the parser.
 */

const encode = (value: unknown): { response: { clientDataJSON: string } } => ({
  response: { clientDataJSON: Buffer.from(JSON.stringify(value)).toString('base64url') },
});

describe('challengeFrom', () => {
  it('reads the challenge out of well-formed client data', () => {
    expect(challengeFrom(encode({ type: 'webauthn.get', challenge: 'abc123' }))).toBe('abc123');
  });

  it('returns null rather than throwing for anything malformed', () => {
    const cases: unknown[] = [
      null,
      undefined,
      'a string',
      42,
      {},
      { response: null },
      { response: {} },
      { response: { clientDataJSON: 42 } },
      { response: { clientDataJSON: 'not base64url !!!' } },
      { response: { clientDataJSON: Buffer.from('not json').toString('base64url') } },
      encode(null),
      encode([1, 2, 3]),
      encode({ type: 'webauthn.get' }),
      encode({ challenge: 42 }),
      encode({ challenge: '' }),
    ];

    for (const input of cases) {
      expect(() => challengeFrom(input)).not.toThrow();
      expect(challengeFrom(input), JSON.stringify(input)).toBeNull();
    }
  });

  it('refuses an unbounded challenge', () => {
    // It becomes a cache key. An unbounded one from an unauthenticated caller
    // is a way to write very large keys very quickly.
    expect(challengeFrom(encode({ challenge: 'x'.repeat(257) }))).toBeNull();
    expect(challengeFrom(encode({ challenge: 'x'.repeat(256) }))).toBe('x'.repeat(256));
  });
});
