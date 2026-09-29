import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const jar = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) => {
        const value = jar.get(name);
        return value === undefined ? undefined : { name, value };
      },
    }),
  headers: () => Promise.resolve(new Headers({ 'x-tenant-id': 'tenant-acme' })),
}));

const { GET } = await import('./route');

const calls: { path: string; body: unknown }[] = [];

function identity(redeem: Response): void {
  vi.stubGlobal('fetch', (url: string, init: { body: string }) => {
    const path = new URL(url, 'http://identity').pathname;
    calls.push({ path, body: JSON.parse(init.body) });
    return Promise.resolve(
      path.endsWith('/handoff/redeem') ? redeem : new Response(null, { status: 204 }),
    );
  });
}

const redeemed = () =>
  Response.json({ sessionId: 'new-session', expiresAt: '2026-09-29T10:00:00.000Z' });

beforeEach(() => {
  jar.clear();
  calls.length = 0;
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('landing from a handoff', () => {
  it('ends the session this browser had here, then sets the new one', async () => {
    jar.set('__Host-ksession', 'old-session');
    identity(redeemed());

    const response = await GET(new Request('http://localhost:3000/auth/callback?code=abc'));

    expect(calls.map((c) => c.path)).toEqual([
      '/api/internal/handoff/redeem',
      '/api/internal/session/revoke',
    ]);
    expect(calls[1]?.body).toEqual({ sessionId: 'old-session', tenantId: 'tenant-acme' });
    expect(response.headers.get('location')).toBe('/');
    expect(response.headers.get('set-cookie')).toContain('__Host-ksession=new-session');
  });

  it('gives the cookie the session’s own end', async () => {
    identity(redeemed());

    const response = await GET(new Request('http://localhost:3000/auth/callback?code=abc'));

    expect(response.headers.get('set-cookie')).toContain('Expires=Tue, 29 Sep 2026 10:00:00 GMT');
    // Nothing to end when the browser arrived without a session.
    expect(calls.map((c) => c.path)).toEqual(['/api/internal/handoff/redeem']);
  });

  it('signs nobody out on a code identity refuses', async () => {
    jar.set('__Host-ksession', 'old-session');
    identity(new Response(null, { status: 401 }));

    const response = await GET(new Request('http://localhost:3000/auth/callback?code=stale'));

    expect(response.headers.get('location')).toBe('/signed-out');
    expect(calls.map((c) => c.path)).toEqual(['/api/internal/handoff/redeem']);
    expect(response.headers.get('set-cookie')).toBeNull();
  });
});
