import { describe, expect, it } from 'vitest';

import { landing, tenantOrigin } from './google';

const auth = new URL('https://auth.app.kithena.com/google/callback');

describe('tenantOrigin', () => {
  it('is the sibling of the auth origin', () => {
    expect(tenantOrigin('acme', auth, '')).toBe('https://acme.app.kithena.com');
  });

  it('follows the configured base where one is set', () => {
    expect(tenantOrigin('acme', auth, 'http://{slug}.app.localhost:3000/')).toBe(
      'http://acme.app.localhost:3000',
    );
  });

  it('is no company for a label that could walk out of the hostname', () => {
    for (const slug of ['', 'Acme', 'a.b', 'evil.com/', 'auth']) {
      expect(tenantOrigin(slug, auth, '')).toBeNull();
    }
  });
});

describe('landing', () => {
  it('sends a sign-in to the company’s callback with the handoff code', () => {
    expect(landing({ tenantSlug: 'acme', code: 'c-1', app: null }, auth, '')).toBe(
      'https://acme.app.kithena.com/auth/callback?code=c-1',
    );
  });

  it('carries the phone app’s sign-in on to the company', () => {
    const to = new URL(
      landing(
        { tenantSlug: 'acme', code: 'c-1', app: { redirect: 'kithena://in', challenge: 'x' } },
        auth,
        '',
      ),
    );
    expect(Object.fromEntries(to.searchParams)).toEqual({
      code: 'c-1',
      app: 'kithena://in',
      challenge: 'x',
    });
  });

  it('sends a refusal back to the company’s sign-in page', () => {
    expect(landing({ tenantSlug: 'acme' }, auth, '')).toBe(
      'https://acme.app.kithena.com/login?error=google',
    );
  });

  it('asks which company when even that is unknown', () => {
    expect(landing({ tenantSlug: null }, auth, '')).toBe('https://auth.app.kithena.com/login');
    expect(landing({}, auth, '')).toBe('https://auth.app.kithena.com/login');
  });
});
