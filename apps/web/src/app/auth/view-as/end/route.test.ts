import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
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
// Starting a view is not what this file tests; `lib/view-as` imports them for it.
vi.mock('../../../../lib/people', () => ({ people: vi.fn() }));
vi.mock('../../../../lib/session', () => ({ currentPerson: vi.fn() }));

const { GET, POST } = await import('./route');

const OWN = '00000000-0000-4000-8000-0000000000a1';
const VIEW = '00000000-0000-4000-8000-0000000000b1';
const PERSON = '00000000-0000-4000-8000-0000000000c1';
const later = Date.parse('2099-01-01T00:00:00.000Z');

const revoked: unknown[] = [];

beforeEach(() => {
  jar.clear();
  revoked.length = 0;
  vi.stubGlobal('fetch', (url: string, init: { body: string }) => {
    if (new URL(url, 'http://identity').pathname === '/api/internal/session/revoke') {
      revoked.push(JSON.parse(init.body));
    }
    return Promise.resolve(new Response(null, { status: 204 }));
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const cookiesOf = (response: Response): string => response.headers.get('set-cookie') ?? '';

describe('ending a view as somebody', () => {
  it('signs the view out in identity and puts the administrator’s own session back', async () => {
    jar.set('__Host-ksession', VIEW);
    jar.set('__Host-kreturn', `${OWN}.${PERSON}.${String(later)}`);

    const response = await POST();

    expect(revoked).toEqual([{ sessionId: VIEW, tenantId: 'tenant-acme' }]);
    expect(response.status).toBe(303);
    // Back to the profile they started from.
    expect(response.headers.get('location')).toBe(`/people/${PERSON}`);
    expect(cookiesOf(response)).toContain(`__Host-ksession=${OWN}`);
    expect(cookiesOf(response)).toMatch(/__Host-kreturn=;.*Max-Age=0/);
    expect(cookiesOf(response)).not.toContain(`__Host-ksession=${VIEW}`);
  });

  it('never leaves the browser signed in as the employee, even when the administrator’s own session is over', async () => {
    jar.set('__Host-ksession', VIEW);
    jar.set('__Host-kreturn', `${OWN}.${PERSON}.${String(Date.now() - 1000)}`);

    const response = await GET();

    expect(revoked).toEqual([{ sessionId: VIEW, tenantId: 'tenant-acme' }]);
    expect(response.headers.get('location')).toBe('/login');
    expect(cookiesOf(response)).toMatch(/__Host-ksession=;.*Max-Age=0/);
    expect(cookiesOf(response)).toMatch(/__Host-kreturn=;.*Max-Age=0/);
  });

  it('signs out, rather than trusts, a return cookie it did not write', async () => {
    jar.set('__Host-ksession', VIEW);
    jar.set('__Host-kreturn', 'not-a-session.whatever.1');

    const response = await POST();

    expect(revoked).toEqual([{ sessionId: VIEW, tenantId: 'tenant-acme' }]);
    expect(response.headers.get('location')).toBe('/login');
    expect(cookiesOf(response)).toMatch(/__Host-ksession=;.*Max-Age=0/);
  });

  it('puts the administrator back once the view’s own cookie has lapsed with it', async () => {
    // Thirty minutes on, the browser has dropped the view-as cookie.
    jar.set('__Host-kreturn', `${OWN}.${PERSON}.${String(later)}`);

    const response = await GET();

    expect(revoked).toEqual([]);
    expect(cookiesOf(response)).toContain(`__Host-ksession=${OWN}`);
  });

  it('changes nothing for somebody who is not viewing', async () => {
    jar.set('__Host-ksession', OWN);

    const response = await POST();

    expect(revoked).toEqual([]);
    expect(response.headers.get('location')).toBe('/');
    expect(response.headers.get('set-cookie')).toBeNull();
  });
});
