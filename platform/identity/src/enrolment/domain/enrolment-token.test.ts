import { describe, expect, it } from 'vitest';
import { fixedClock } from '@kithena/domain-kit';

import {
  acceptToken,
  tokenStillValid,
  hashEnrolmentToken,
  hashesMatch,
  mintEnrolmentToken,
  type EnrolmentToken,
} from './enrolment-token.js';

/**
 * The one moment in this design that is not phishing-resistant.
 *
 * Everything after enrolment rests on a passkey. Enrolment rests on a token
 * somebody was sent, so each of its properties is worth a test rather than a
 * comment.
 */

const TENANT = '00000000-0000-4000-8000-00000000000a';
const OTHER = '00000000-0000-4000-8000-00000000000b';

const token = (over: Partial<EnrolmentToken> = {}): EnrolmentToken => ({
  id: '00000000-0000-4000-8000-0000000000e1',
  tenantId: TENANT,
  accountId: '00000000-0000-4000-8000-0000000000a1',
  secondChannel: 'in_person',
  expiresAt: '2026-04-04T09:00:00.000Z',
  consumedAt: null,
  ...over,
});

const clock = fixedClock('2026-04-01T09:00:00.000Z');

describe('mintEnrolmentToken', () => {
  it('produces a token nobody is going to guess', () => {
    // 32 bytes, base64url. 256 bits of entropy means no rate limit has to be
    // load-bearing for this to be safe.
    const { token: value } = mintEnrolmentToken();
    expect(value.length).toBeGreaterThanOrEqual(43);
    expect(value).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('never produces the same token twice', () => {
    const seen = new Set(Array.from({ length: 500 }, () => mintEnrolmentToken().token));
    expect(seen.size).toBe(500);
  });

  it('hands back a hash that matches the token, and is not the token', () => {
    // What goes in the row is the hash. A backup, a replica or a support query
    // must not yield anything usable.
    const { token: value, hash } = mintEnrolmentToken();
    expect(hash.toString('base64url')).not.toBe(value);
    expect(hashesMatch(hash, hashEnrolmentToken(value))).toBe(true);
  });

  it('does not match a different token', () => {
    const a = mintEnrolmentToken();
    const b = mintEnrolmentToken();
    expect(hashesMatch(a.hash, b.hash)).toBe(false);
  });
});

describe('acceptToken', () => {
  it('accepts a live token on the hostname it was issued for', () => {
    expect(acceptToken(token(), TENANT, clock).ok).toBe(true);
  });

  it('refuses a token that has already been used', () => {
    // Single use. The database enforces it atomically; this refuses a row that
    // somehow arrives already consumed.
    expect(acceptToken(token({ consumedAt: '2026-04-01T08:00:00.000Z' }), TENANT, clock).ok).toBe(
      false,
    );
  });

  it('refuses a genuine token presented on another company’s hostname', () => {
    // Otherwise a link mailed to somebody at one customer becomes a way to
    // probe another. The account would not be found there either, but failing
    // here fails earlier and more clearly.
    expect(acceptToken(token(), OTHER, clock).ok).toBe(false);
  });

  it('refuses an expired token', () => {
    expect(acceptToken(token({ expiresAt: '2026-03-30T09:00:00.000Z' }), TENANT, clock).ok).toBe(
      false,
    );
  });

  it('refuses at the exact moment of expiry, not a millisecond after', () => {
    expect(acceptToken(token({ expiresAt: '2026-04-01T09:00:00.000Z' }), TENANT, clock).ok).toBe(
      false,
    );
  });

  it('says the same thing however it failed', () => {
    // A caller learns the link does not work. Not whether it expired, was
    // used, or belongs to a different company — the last of which would
    // confirm that the account exists somewhere.
    const used = acceptToken(token({ consumedAt: '2026-04-01T08:00:00Z' }), TENANT, clock);
    const wrongTenant = acceptToken(token(), OTHER, clock);
    const expired = acceptToken(token({ expiresAt: '2026-01-01T00:00:00Z' }), TENANT, clock);

    if (used.ok || wrongTenant.ok || expired.ok) throw new Error('all three should refuse');
    expect(used.error).toEqual(wrongTenant.error);
    expect(used.error).toEqual(expired.error);
  });
});

describe('hashesMatch', () => {
  it('refuses hashes of different lengths rather than throwing', () => {
    // `timingSafeEqual` throws on a length mismatch, which is itself a leak of
    // the length. Compared first.
    expect(() => hashesMatch(Buffer.alloc(32), Buffer.alloc(16))).not.toThrow();
    expect(hashesMatch(Buffer.alloc(32), Buffer.alloc(16))).toBe(false);
  });
});

describe('tokenStillValid', () => {
  it('accepts a token that has just been consumed by the caller', () => {
    // The distinction that matters. Spending a token is one atomic statement,
    // and what comes back has `consumedAt` already set — by us, a moment ago.
    // The full rule would refuse it, which would refuse every enrolment.
    const justSpent = token({ consumedAt: '2026-04-01T09:00:00.000Z' });

    expect(tokenStillValid(justSpent, TENANT, clock).ok).toBe(true);
    expect(acceptToken(justSpent, TENANT, clock).ok).toBe(false);
  });

  it('still refuses another company’s token', () => {
    expect(tokenStillValid(token({ consumedAt: '2026-04-01T09:00:00Z' }), OTHER, clock).ok).toBe(
      false,
    );
  });

  it('still refuses an expired one', () => {
    const stale = token({ consumedAt: '2026-04-01T09:00:00Z', expiresAt: '2026-03-01T00:00:00Z' });
    expect(tokenStillValid(stale, TENANT, clock).ok).toBe(false);
  });
});
