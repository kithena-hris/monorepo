import { describe, expect, it } from 'vitest';

import { RESERVED_SLUGS, resolveTenant, slugFromHost, type Tenant } from './tenant';

/**
 * These are isolation tests, not routing tests.
 *
 * Every case below is a way one company could be shown another company's data,
 * or a hostname nobody issued could be made to look like a tenant. The happy
 * path is one test; the rest is the reason the file exists.
 */

const SUFFIX = 'app.kithena.com';

const acme: Tenant = { id: 'tenant-acme', slug: 'acme', status: 'active' };
const lookup = (slug: string): Promise<Tenant | null> =>
  Promise.resolve(
    slug === 'acme' ? acme : slug === 'lapsed' ? { ...acme, slug, status: 'suspended' } : null,
  );

describe('slugFromHost', () => {
  it('takes the label in front of the suffix', () => {
    expect(slugFromHost('acme.app.kithena.com', SUFFIX)).toBe('acme');
  });

  it('ignores a port, trailing dot and casing', () => {
    // All three are legal in a Host header and none changes which tenant is
    // meant. `ACME.` with a port used to be three different tenants.
    expect(slugFromHost('ACME.app.kithena.com:3000', SUFFIX)).toBe('acme');
    expect(slugFromHost('acme.app.kithena.com.', SUFFIX)).toBe('acme');
  });

  it('refuses a host that does not end in the suffix', () => {
    // The attack this stops: registering `acme.app.kithena.com.evil.com`,
    // pointing it anywhere, and having the app read the first label.
    expect(slugFromHost('acme.app.kithena.com.evil.com', SUFFIX)).toBeNull();
    expect(slugFromHost('acme.app.kithena.com.uk', SUFFIX)).toBeNull();
    expect(slugFromHost('evil.com', SUFFIX)).toBeNull();
  });

  it('refuses more than one label in front of the suffix', () => {
    // A wildcard certificate covers `*.app.kithena.com` and nothing deeper, so
    // `a.b.app.kithena.com` is a hostname we never issued.
    expect(slugFromHost('a.b.app.kithena.com', SUFFIX)).toBeNull();
  });

  it('refuses the bare suffix', () => {
    expect(slugFromHost('app.kithena.com', SUFFIX)).toBeNull();
  });

  it('refuses every reserved label', () => {
    for (const reserved of RESERVED_SLUGS) {
      expect(slugFromHost(`${reserved}.${SUFFIX}`, SUFFIX), reserved).toBeNull();
    }
  });

  it('refuses labels DNS itself would refuse', () => {
    expect(slugFromHost('-acme.app.kithena.com', SUFFIX)).toBeNull();
    expect(slugFromHost('acme-.app.kithena.com', SUFFIX)).toBeNull();
    expect(slugFromHost('ac--me.app.kithena.com', SUFFIX)).toBeNull();
    expect(slugFromHost('ac_me.app.kithena.com', SUFFIX)).toBeNull();
    expect(slugFromHost('a.app.kithena.com', SUFFIX)).toBeNull();
    expect(slugFromHost(`${'a'.repeat(64)}.app.kithena.com`, SUFFIX)).toBeNull();
  });

  it('refuses a missing or empty host', () => {
    expect(slugFromHost(null, SUFFIX)).toBeNull();
    expect(slugFromHost('', SUFFIX)).toBeNull();
    expect(slugFromHost(':3000', SUFFIX)).toBeNull();
  });

  it('refuses when no suffix is configured', () => {
    // Misconfiguration must not turn into "every host is a tenant".
    expect(slugFromHost('acme.app.kithena.com', '')).toBeNull();
  });

  it('keeps staging and production apart', () => {
    // The staging suffix is longer, so a production host must not resolve
    // against it or a staging deployment could serve production tenants.
    const staging = 'staging.app.kithena.com';
    expect(slugFromHost(`acme.${staging}`, staging)).toBe('acme');
    expect(slugFromHost(`acme.${staging}`, SUFFIX)).toBeNull();
    expect(slugFromHost(`acme.${SUFFIX}`, staging)).toBeNull();
  });
});

describe('resolveTenant', () => {
  it('resolves an active tenant', async () => {
    const { tenant } = await resolveTenant(`acme.${SUFFIX}`, SUFFIX, lookup);
    expect(tenant).toEqual(acme);
  });

  it('returns nothing for an unknown tenant', async () => {
    const { tenant, reason } = await resolveTenant(`nobody.${SUFFIX}`, SUFFIX, lookup);
    expect(tenant).toBeNull();
    expect(reason).toBe('unknown');
  });

  it('returns nothing for a suspended tenant, and says so only in the reason', async () => {
    // The distinction exists for an operator reading a log. The caller gets the
    // same nothing as a typo, because "this account is suspended" on a public
    // hostname tells an outsider the company is a customer.
    const { tenant, reason } = await resolveTenant(`lapsed.${SUFFIX}`, SUFFIX, lookup);
    expect(tenant).toBeNull();
    expect(reason).toBe('suspended');
  });

  it('never calls the lookup for a reserved label', async () => {
    let called = 0;
    const counting = (slug: string): Promise<Tenant | null> => {
      called += 1;
      return lookup(slug);
    };
    await resolveTenant(`admin.${SUFFIX}`, SUFFIX, counting);
    expect(called).toBe(0);
  });
});
