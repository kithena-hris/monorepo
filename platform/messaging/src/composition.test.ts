import { describe, expect, it } from 'vitest';

import { DEFAULT_TENANT_APP_BASE, selectTenantAppBase } from './composition.js';

describe('selectTenantAppBase', () => {
  it('defaults to the local app in development', () => {
    expect(selectTenantAppBase({ tenantAppBase: undefined, allowLogTransport: true })).toBe(
      DEFAULT_TENANT_APP_BASE,
    );
  });

  it('fails closed in production: unset, plain http or slugless trusts no link', () => {
    for (const tenantAppBase of [
      undefined,
      '',
      'http://{slug}.app.kithena.com',
      'https://app.kithena.com',
    ]) {
      expect(selectTenantAppBase({ tenantAppBase, allowLogTransport: false })).toBeNull();
    }
    expect(
      selectTenantAppBase({
        tenantAppBase: 'https://{slug}.app.kithena.com',
        allowLogTransport: false,
      }),
    ).toBe('https://{slug}.app.kithena.com');
  });
});
