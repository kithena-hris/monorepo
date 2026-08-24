import { describe, expect, it } from 'vitest';

import { THEME_PRESETS } from '@kithena/contracts';

import { checkProvisionable, type ProvisionRequest } from './provision.js';

const address = {
  country: 'ES',
  line1: 'Calle de Alcalá 45',
  line2: null,
  city: 'Madrid',
  subdivision: '28',
  postcode: '28013',
};

const request = (over: Partial<ProvisionRequest> = {}): ProvisionRequest => ({
  slug: 'acme',
  displayName: 'Acme Corp',
  admins: ['ada@acme.example', 'grace@acme.example'],
  themeId: 'indigo',
  logoUrl: null,
  coverImageUrl: null,
  address,
  ...over,
});

describe('checkProvisionable', () => {
  it('accepts a well-formed company', () => {
    expect(checkProvisionable(request()).ok).toBe(true);
  });

  it('refuses a label that cannot be a hostname', () => {
    for (const slug of ['-acme', 'acme-', 'ACME', 'ac', 'a c m e', 'xn--pple-43d']) {
      expect(checkProvisionable(request({ slug })).ok, slug).toBe(false);
    }
  });

  it('tells a reserved label apart from a malformed one', () => {
    // Two different things to be told: "that cannot be a hostname" and "that
    // one is ours". A single message would send somebody looking for a typo in
    // a name that is perfectly well formed.
    const malformed = checkProvisionable(request({ slug: '-acme' }));
    const reserved = checkProvisionable(request({ slug: 'admin' }));
    if (malformed.ok || reserved.ok) throw new Error('both should refuse');

    expect(malformed.error.code).toBe('SLUG_MALFORMED');
    expect(reserved.error.code).toBe('SLUG_RESERVED');
  });

  it('refuses every reserved label, including the ones we serve from', () => {
    for (const slug of ['auth', 'login', 'admin', 'app', 'api', 'www']) {
      expect(checkProvisionable(request({ slug })).ok, slug).toBe(false);
    }
  });

  it('insists on at least one administrator', () => {
    // Was two until 2026-08-22. The rule is now one, at the product owner's
    // explicit instruction; docs/auth-administration.md records what that costs.
    // Zero is still refused: a company nobody can sign in to is not a company.
    expect(checkProvisionable(request({ admins: [] })).ok).toBe(false);
    expect(checkProvisionable(request({ admins: ['ada@acme.example'] })).ok).toBe(true);
  });

  it('does not count the same person twice', () => {
    // Two entries differing only in case or spacing are one administrator. That
    // no longer changes whether the request is accepted, but it must still not
    // produce two invitations to one mailbox.
    const result = checkProvisionable(
      request({ admins: ['ada@acme.example', ' ADA@acme.example '] }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.admins).toEqual(['ada@acme.example']);
  });

  it('normalises the addresses it accepts', () => {
    const result = checkProvisionable(
      request({ admins: [' Ada@Acme.example ', 'grace@acme.example', ''] }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.admins).toEqual(['ada@acme.example', 'grace@acme.example']);
  });

  it('refuses a company with no name', () => {
    expect(checkProvisionable(request({ displayName: '   ' })).ok).toBe(false);
  });
});

describe('the registered address', () => {
  it('refuses an address whose postcode does not fit its country', () => {
    const result = checkProvisionable(request({ address: { ...address, postcode: '99999' } }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('ADDRESS_INVALID');
  });

  it('refuses a postcode that contradicts the province it names', () => {
    // 08 is Barcelona and 28013 is Madrid. Neither field is wrong alone, which
    // is why a per-field check would pass this.
    expect(checkProvisionable(request({ address: { ...address, subdivision: '08' } })).ok).toBe(
      false,
    );
  });

  it('refuses a country whose rules nobody has verified', () => {
    expect(checkProvisionable(request({ address: { ...address, country: 'ZZ' } })).ok).toBe(false);
  });

  it('carries the reason out to the field it belongs to', () => {
    // The wizard puts the message under one input, so a failure that cannot say
    // which field it came from would have to be shown against the whole step.
    const result = checkProvisionable(request({ address: { ...address, city: '' } }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.path).toContain('address.city');
  });
});

describe('branding', () => {
  it('refuses a theme that is not one of ours', () => {
    const result = checkProvisionable(request({ themeId: 'hotpink' }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('THEME_UNKNOWN');
  });

  it('accepts every preset the design system offers', () => {
    for (const preset of THEME_PRESETS) {
      expect(checkProvisionable(request({ themeId: preset.id })).ok, preset.id).toBe(true);
    }
  });

  it('treats both images as optional', () => {
    expect(checkProvisionable(request({ logoUrl: null, coverImageUrl: null })).ok).toBe(true);
  });

  it('refuses an image that is not somewhere we put images', () => {
    // The uploader returns a blob URL. Anything else arriving here came from a
    // caller constructing the request by hand, and a stored off-site URL is a
    // customer's login page loading an image somebody else can swap.
    expect(checkProvisionable(request({ logoUrl: 'https://evil.example/logo.png' })).ok).toBe(
      false,
    );
  });
});
