import { beforeEach, describe, expect, it, vi } from 'vitest';

const jar = new Map<string, string>();
const calls: { path: string; body: unknown }[] = [];
let answer: { status: number; body: unknown } = { status: 201, body: { code: 'c0de/+=' } };

// `lib/session` is `server-only`, which only resolves inside Next.
vi.mock('../../../../lib/session', () => ({ SESSION_COOKIE: '__Host-kithena_operator' }));
vi.mock('next/headers', () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) => {
        const value = jar.get(name);
        return value === undefined ? undefined : { name, value };
      },
    }),
}));
vi.mock('../../../../lib/identity', () => ({
  callIdentity: (path: string, init?: { body?: unknown }) => {
    calls.push({ path, body: init?.body });
    return Promise.resolve(
      path === '/api/internal/support/start' ? answer : { status: 200, body: { slug: 'acme' } },
    );
  },
}));

const { POST } = await import('./route');

const ID = '00000000-0000-4000-8000-00000000000a';

function post(form: Record<string, string>, origin = 'http://localhost:3001') {
  return POST(
    new Request(`http://localhost:3001/companies/${ID}/support`, {
      method: 'POST',
      headers: { origin, host: 'localhost:3001' },
      body: new URLSearchParams(form),
    }),
    { params: Promise.resolve({ id: ID }) },
  );
}

beforeEach(() => {
  jar.clear();
  jar.set('__Host-kithena_operator', 'operator-session');
  calls.length = 0;
  answer = { status: 201, body: { code: 'c0de/+=' } };
});

describe('signing in as support from the back office', () => {
  it('sends identity the operator’s session, never an operator id from the form', async () => {
    const response = await post({ reason: 'Ticket #4821', operatorId: 'somebody-else' });

    expect(calls.find((c) => c.path === '/api/internal/support/start')?.body).toEqual({
      operatorSessionId: 'operator-session',
      tenantId: ID,
      reason: 'Ticket #4821',
    });
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(
      'http://acme.app.localhost:3000/auth/callback?code=c0de%2F%2B%3D',
    );
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it('refuses a post from another origin without asking identity', async () => {
    expect((await post({ reason: 'x' }, 'https://evil.example')).status).toBe(403);
    // What a sandboxed or no-referrer form sends.
    expect((await post({ reason: 'x' }, 'null')).status).toBe(403);
    expect(calls).toEqual([]);
  });

  it('sends somebody with no session to sign in', async () => {
    jar.clear();
    const response = await post({ reason: 'x' });
    expect(response.headers.get('location')).toBe('/sign-in');
    expect(calls).toEqual([]);
  });

  it('comes back to the company page when identity refuses', async () => {
    answer = { status: 400, body: { code: 'SUPPORT_REASON_REQUIRED' } };
    expect((await post({ reason: ' ' })).headers.get('location')).toBe(
      `/companies/${ID}?support=reason`,
    );
    answer = { status: 401, body: {} };
    expect((await post({ reason: 'x' })).headers.get('location')).toBe('/sign-in');
    answer = { status: 500, body: null };
    expect((await post({ reason: 'x' })).headers.get('location')).toBe(
      `/companies/${ID}?support=failed`,
    );
  });
});
