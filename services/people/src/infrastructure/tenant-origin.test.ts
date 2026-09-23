import { describe, expect, it } from 'vitest';

import { DEFAULT_TENANT_APP_BASE, tenantCompanies, tenantOrigin } from './tenant-origin.js';
import { DEFAULT_SETTINGS } from '../application/org/org.js';

describe('tenantOrigin', () => {
  it('puts the slug where the base says', () => {
    expect(tenantOrigin('https://{slug}.app.kithena.com', 'acme')).toBe(
      'https://acme.app.kithena.com',
    );
    expect(tenantOrigin(DEFAULT_TENANT_APP_BASE, 'acme')).toBe('http://acme.app.localhost:3000');
  });

  it('refuses a slug that is not one host label, rather than guessing', () => {
    for (const slug of ['', 'Acme', 'acme.evil.com', 'acme/..', '-acme', 'a b', 'evil.com#']) {
      expect(tenantOrigin('https://{slug}.app.kithena.com', slug)).toBeNull();
    }
  });

  it('refuses a base with nowhere to put the slug', () => {
    expect(tenantOrigin('https://app.kithena.com', 'acme')).toBeNull();
  });
});

describe('tenantCompanies', () => {
  const companyOf = (slug: string | null, displayName: string | null) =>
    tenantCompanies('https://{slug}.app.kithena.com', {
      settings: () => Promise.resolve({ ...DEFAULT_SETTINGS, slug, displayName }),
    })(null as never, 't');

  it('is the name and the origin once both are known', async () => {
    expect(await companyOf('acme', 'Acme Corp')).toEqual({
      name: 'Acme Corp',
      origin: 'https://acme.app.kithena.com',
    });
  });

  it('is nothing until the back office has told People both', async () => {
    expect(await companyOf(null, 'Acme Corp')).toBeNull();
    expect(await companyOf('acme', null)).toBeNull();
    expect(await companyOf('acme', '  ')).toBeNull();
    expect(await companyOf('not a label', 'Acme Corp')).toBeNull();
  });
});
