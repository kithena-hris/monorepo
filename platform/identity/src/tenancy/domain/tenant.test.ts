import { describe, expect, it } from 'vitest';

import { admit, brandingFor, isLookupWorthwhile, type Tenant } from './tenant.js';

/**
 * These are isolation tests, not lookup tests.
 *
 * Every case is a way a request could be served against a tenant that should
 * not have been served at all. The happy path is one test; the rest is the
 * reason the file exists.
 */

const acme: Tenant = {
  id: '00000000-0000-4000-8000-000000000001',
  slug: 'acme',
  status: 'active',
  branding: {
    displayName: null,
    logoUrl: null,
    coverImageUrl: null,
    themeId: null,
    accentColor: null,
  },
};

describe('isLookupWorthwhile', () => {
  it('accepts a well-formed, unreserved label', () => {
    expect(isLookupWorthwhile('acme')).toBe(true);
  });

  it('refuses a reserved label without a query', () => {
    // `auth` and `login` are the identity provider's own hostnames. A tenant
    // holding either could serve a login page on an origin the product treats
    // as its own.
    expect(isLookupWorthwhile('auth')).toBe(false);
    expect(isLookupWorthwhile('login')).toBe(false);
    expect(isLookupWorthwhile('admin')).toBe(false);
  });

  it('refuses a punycode-shaped label', () => {
    // `xn--pple-43d` renders as `äpple`. A tenant registering one displays as
    // another tenant's name.
    expect(isLookupWorthwhile('xn--pple-43d')).toBe(false);
  });

  it('refuses labels DNS itself would refuse', () => {
    expect(isLookupWorthwhile('-acme')).toBe(false);
    expect(isLookupWorthwhile('acme-')).toBe(false);
    expect(isLookupWorthwhile('ACME')).toBe(false);
    expect(isLookupWorthwhile('ac')).toBe(false);
  });
});

describe('admit', () => {
  it('admits an active tenant', () => {
    const result = admit(acme);
    expect(result.ok).toBe(true);
  });

  it.each(['suspended', 'closed'] as const)('refuses a %s tenant', (status) => {
    // Keeping the records is not the same as serving the requests. A lapsed
    // customer's employment history survives; their logins do not.
    const result = admit({ ...acme, status });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('TENANT_UNRESOLVABLE');
    expect(result.error.path).toEqual([status]);
  });

  it('says the same thing to a caller whatever the reason', () => {
    // The reason is in `path`, for logs. The message is identical, because a
    // message that distinguishes "suspended" from "unknown" tells whoever is
    // probing slugs which companies are customers.
    const suspended = admit({ ...acme, status: 'suspended' });
    const closed = admit({ ...acme, status: 'closed' });
    if (suspended.ok || closed.ok) throw new Error('both should fail');
    expect(suspended.error.message).toBe(closed.error.message);
  });
});

describe('brandingFor', () => {
  const row = {
    displayName: 'Acme Corp',
    logoUrl: 'https://assets.example/acme.png',
    accentColor: 'oklch(0.55 0.18 264)',
    brandingPublic: true,
  };

  it('names the company when it has agreed to be named', () => {
    expect(brandingFor(row)).toEqual({
      displayName: 'Acme Corp',
      logoUrl: 'https://assets.example/acme.png',
      coverImageUrl: null,
      themeId: null,
      accentColor: 'oklch(0.55 0.18 264)',
    });
  });

  it('says nothing at all when it has not', () => {
    // Not "no logo but still the name". A login page that says "Acme Corp"
    // confirms Acme is a customer just as surely as one that shows the mark,
    // and confirming that is the whole thing being withheld.
    expect(brandingFor({ ...row, brandingPublic: false })).toEqual({
      displayName: null,
      logoUrl: null,
      coverImageUrl: null,
      themeId: null,
      accentColor: null,
    });
  });

  it('passes through a company that has uploaded nothing', () => {
    const bare = { ...row, logoUrl: null, accentColor: null };
    expect(brandingFor(bare)).toEqual({
      displayName: 'Acme Corp',
      logoUrl: null,
      coverImageUrl: null,
      themeId: null,
      accentColor: null,
    });
  });
});
