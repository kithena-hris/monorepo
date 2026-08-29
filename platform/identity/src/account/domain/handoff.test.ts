import { describe, expect, it } from 'vitest';

import { HANDOFF_TTL_SECONDS, checkRedeemable, hashCode, issuedCode } from './handoff.js';

const NOW = new Date('2026-08-28T12:00:00.000Z');

describe('issuedCode', () => {
  it('expires a minute out', () => {
    const issued = issuedCode(NOW);
    expect(issued.expiresAt.getTime() - NOW.getTime()).toBe(HANDOFF_TTL_SECONDS * 1000);
  });

  it('is long enough not to be guessed', () => {
    // 256 bits, base64url. Anything shorter is a code somebody can grind
    // against a sixty-second window.
    expect(issuedCode(NOW).code.length).toBeGreaterThanOrEqual(43);
  });

  it('never repeats', () => {
    const seen = new Set(Array.from({ length: 200 }, () => issuedCode(NOW).code));
    expect(seen.size).toBe(200);
  });

  /*
   * The plaintext is returned once and the hash is what is stored. If these
   * were the same value, the table would hold something redeemable and the
   * whole point of hashing it would be gone.
   */
  it('hands back a code that is not what gets stored', () => {
    const issued = issuedCode(NOW);
    expect(issued.codeHash).not.toBe(issued.code);
    expect(issued.codeHash).toEqual(hashCode(issued.code));
  });
});

describe('hashCode', () => {
  it('is stable for the same input', () => {
    expect(hashCode('abc')).toEqual(hashCode('abc'));
  });

  it('differs for different input', () => {
    expect(hashCode('abc')).not.toEqual(hashCode('abd'));
  });
});

describe('checkRedeemable', () => {
  const live = {
    tenantId: 't-1',
    sessionId: 's-1',
    expiresAt: new Date(NOW.getTime() + 30_000),
    redeemedAt: null,
  };

  it('accepts a live code presented by its own tenant', () => {
    const result = checkRedeemable(live, 't-1', NOW);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.sessionId).toBe('s-1');
  });

  it('refuses a code that has expired', () => {
    const result = checkRedeemable(live, 't-1', new Date(NOW.getTime() + 61_000));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('HANDOFF_REFUSED');
  });

  it('refuses a code that was already redeemed', () => {
    const result = checkRedeemable({ ...live, redeemedAt: NOW }, 't-1', NOW);
    expect(result.ok).toBe(false);
  });

  /*
   * The one that matters. The tenant app takes the tenant from its own hostname
   * and passes it in, so a code issued for Acme presented at Globex's origin is
   * refused here — rather than handing Globex a session belonging to somebody
   * at Acme and hoping row-level security notices afterwards.
   */
  it('refuses a code issued for a different company', () => {
    const result = checkRedeemable(live, 't-2', NOW);
    expect(result.ok).toBe(false);
  });

  /*
   * Expired, spent, and belonging to someone else are one answer to the caller.
   * Separating them tells whoever is probing which codes ever existed.
   */
  it('gives the same refusal for every reason', () => {
    const wrongTenant = checkRedeemable(live, 't-2', NOW);
    const expired = checkRedeemable(live, 't-1', new Date(NOW.getTime() + 61_000));
    const spent = checkRedeemable({ ...live, redeemedAt: NOW }, 't-1', NOW);

    for (const refusal of [wrongTenant, expired, spent]) {
      expect(refusal.ok).toBe(false);
    }
    // Identical, not merely all-falsy: a caller must not be able to tell a
    // spent code from one that never belonged to them.
    expect(wrongTenant).toEqual(expired);
    expect(expired).toEqual(spent);
  });

  it('treats the expiry instant itself as expired', () => {
    // A code alive "until" a moment is not alive at it. The boundary is stated
    // rather than left to whichever comparison someone typed.
    const result = checkRedeemable({ ...live, expiresAt: NOW }, 't-1', NOW);
    expect(result.ok).toBe(false);
  });
});
