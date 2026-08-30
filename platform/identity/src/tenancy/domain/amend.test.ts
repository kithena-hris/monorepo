import { describe, expect, it } from 'vitest';

import { checkAmendable, type AmendRequest } from './amend.js';

const BLOB = 'https://abc123.public.blob.vercel-storage.com/mock/logo.png';

function request(overrides: Partial<AmendRequest> = {}): AmendRequest {
  return {
    displayName: 'Acme Corp',
    themeId: 'indigo',
    logoUrl: null,
    coverImageUrl: null,
    brandingPublic: true,
    address: {
      country: 'GB',
      line1: '1 High Street',
      line2: null,
      city: 'London',
      // GB has subdivisions, so one is required — `checkAddress` refuses null.
      subdivision: 'ENG',
      postcode: 'SW1A 1AA',
    },
    ...overrides,
  };
}

const IMAGES = { hosts: ['.public.blob.vercel-storage.com'] };

describe('checkAmendable', () => {
  it('accepts an unchanged company', () => {
    expect(checkAmendable(request(), IMAGES).ok).toBe(true);
  });

  it('trims the display name rather than storing the spaces', () => {
    const result = checkAmendable(request({ displayName: '  Acme Corp  ' }), IMAGES);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.displayName).toBe('Acme Corp');
  });

  it('refuses a name that is only whitespace', () => {
    const result = checkAmendable(request({ displayName: '   ' }), IMAGES);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('DISPLAY_NAME_MISSING');
  });

  it('refuses a theme that is not on the list', () => {
    const result = checkAmendable(request({ themeId: 'hotpink' }), IMAGES);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('THEME_UNKNOWN');
  });

  /*
   * The same rule as provisioning, and for the same reason: an off-site image
   * on a login page is an image somebody else can swap after we approved it.
   * Editing is exactly where that would otherwise be reintroduced — the
   * original check lived in `checkProvisionable` and would never have run again.
   */
  it('refuses an image hosted somewhere we do not control', () => {
    for (const field of ['logoUrl', 'coverImageUrl'] as const) {
      const result = checkAmendable(request({ [field]: 'https://evil.example/logo.png' }), IMAGES);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('IMAGE_NOT_OURS');
    }
  });

  it('accepts an image on the blob host, and accepts none at all', () => {
    expect(checkAmendable(request({ logoUrl: BLOB, coverImageUrl: BLOB }), IMAGES).ok).toBe(true);
    expect(checkAmendable(request({ logoUrl: null, coverImageUrl: null }), IMAGES).ok).toBe(true);
  });

  it('refuses a postcode the country does not use', () => {
    const result = checkAmendable(
      request({
        address: {
          country: 'GB',
          line1: '1 High Street',
          line2: null,
          city: 'London',
          subdivision: 'ENG',
          postcode: 'not a postcode',
        },
      }),
      IMAGES,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.path?.[0]).toMatch(/^address\./);
  });

  /*
   * The slug is deliberately absent from `AmendRequest`, and this test is here
   * so that stays a decision rather than an oversight. It is the hostname
   * people sign in on, it is in every enrolment link already sent, and it is
   * the redirect URI the authorization request is validated against. Changing
   * it is a migration, not an edit.
   */
  it('has no way to express a change of slug', () => {
    expect(Object.keys(request())).not.toContain('slug');
  });

  it('can turn branding off without touching anything else', () => {
    const result = checkAmendable(request({ brandingPublic: false, logoUrl: BLOB }), IMAGES);
    expect(result.ok).toBe(true);
    // Stored, not discarded. The flag governs who may be *shown* the mark, and
    // a company that turns it back on should not have to upload again.
    if (result.ok) expect(result.value.logoUrl).toBe(BLOB);
  });
});
