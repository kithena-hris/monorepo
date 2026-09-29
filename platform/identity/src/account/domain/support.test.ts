import { describe, expect, it } from 'vitest';

import {
  SUPPORT_REASON_MAX,
  SUPPORT_SESSION_SECONDS,
  supportAccountProfile,
  supportReason,
  supportSessionWindow,
} from './support.js';

describe('the reason an operator gives', () => {
  it('is required', () => {
    for (const raw of [undefined, null, '', '   \n\t ', 42]) {
      const result = supportReason(raw);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('SUPPORT_REASON_REQUIRED');
    }
  });

  it('is trimmed', () => {
    const result = supportReason('  Ticket #4821  ');
    expect(result.ok && result.value).toBe('Ticket #4821');
  });

  it('is bounded', () => {
    expect(supportReason('x'.repeat(SUPPORT_REASON_MAX)).ok).toBe(true);
    const long = supportReason('x'.repeat(SUPPORT_REASON_MAX + 1));
    expect(long.ok).toBe(false);
    if (!long.ok) expect(long.error.code).toBe('SUPPORT_REASON_TOO_LONG');
  });
});

describe('a support session', () => {
  it('lasts one hour from the moment it starts, and no longer', () => {
    expect(SUPPORT_SESSION_SECONDS).toBe(3600);
    expect(supportSessionWindow(new Date('2026-09-29T09:00:00.000Z'))).toEqual({
      startedAt: '2026-09-29T09:00:00.000Z',
      expiresAt: '2026-09-29T10:00:00.000Z',
    });
  });
});

describe('the support account', () => {
  it('is called Kithena support and has an address nothing can deliver to', () => {
    const profile = supportAccountProfile('acme');
    expect(`${profile.givenName} ${profile.familyName}`).toBe('Kithena support');
    // `.invalid` is reserved (RFC 2606): no mail reaches it, so no link mailed
    // to it can be used to attach a credential.
    expect(profile.workEmail).toBe('support@acme.support.kithena.invalid');
  });
});
