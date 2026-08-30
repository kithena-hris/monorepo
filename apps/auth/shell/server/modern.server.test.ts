import { afterEach, describe, expect, it, vi } from 'vitest';

import type { MiddlewareHandler } from '@modern-js/server-runtime';

import { identityProxy } from './modern.server.js';

/**
 * Hono's `Context` has twenty-odd members and this middleware touches four.
 * Constructing a real one would mean standing up a server to assert something
 * that is about the handler, so the fake supplies what is used and is cast
 * once, here, rather than at every call.
 */
type Ctx = Parameters<MiddlewareHandler>[0];

/**
 * The session id must not reach the browser.
 *
 * This is the property the middleware exists for. The arrangement it replaced —
 * a dev-server proxy — passed the response body through untouched, so the id
 * arrived as JSON that any script on the origin could read. That is exactly
 * what an `HttpOnly` cookie prevents, on the one origin where losing it hands
 * over an account.
 *
 * Tested against the handler rather than through a running server, because the
 * assertion is about what comes *out*: a cookie set, and the id absent from the
 * body. A live ceremony would exercise the same lines and be unable to fail for
 * the reason that matters.
 */

interface Captured {
  headers: [string, string][];
  json?: { body: unknown; status: number };
  body?: { text: string; status: number };
}

/** The two pieces of Hono's context this middleware touches. */
function context(path: string, method = 'GET'): { c: Ctx; captured: Captured } {
  const captured: Captured = { headers: [] };
  const c = {
    req: {
      path,
      method,
      url: `http://auth.staging.app.kithena.com${path}`,
      raw: { headers: new Headers({ 'user-agent': 'test' }), arrayBuffer: () => new ArrayBuffer(0) },
    },
    header: (name: string, value: string) => captured.headers.push([name, value]),
    json: (body: unknown, status: number) => {
      captured.json = { body, status };
      return { kind: 'json' };
    },
    body: (text: string, status: number) => {
      captured.body = { text, status };
      return { kind: 'body' };
    },
  };
  return { c: c as unknown as Ctx, captured };
}

const upstream = (payload: unknown, status = 200): void => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response(JSON.stringify(payload), { status }))),
  );
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the identity proxy', () => {
  it('turns a session id into a cookie and takes it out of the body', async () => {
    upstream({ sessionId: 's3cr3t-session', accountId: 'acct-1' });
    // The ceremony's finish, which is the response that actually carries a
    // session id. `/api/identity/session` is the tenant app's server-to-server
    // check and is not reachable from a browser at all — see the allowlist.
    const { c, captured } = context('/api/identity/webauthn/authenticate/finish', 'POST');

    await identityProxy(c, () => Promise.resolve());

    const cookie = captured.headers.find(([name]) => name === 'set-cookie')?.[1] ?? '';
    expect(cookie).toContain('__Host-kithena_session=s3cr3t-session');

    // Removed, not merely also-set. Leaving it would make the value both an
    // HttpOnly cookie and a string any script can read — the same exposure
    // with an extra step.
    expect(captured.json?.body).toEqual({ accountId: 'acct-1' });
    expect(JSON.stringify(captured.json?.body)).not.toContain('s3cr3t-session');
  });

  it('sets the flags that make the cookie worth setting', async () => {
    upstream({ sessionId: 'abc' });
    const { c, captured } = context('/api/identity/webauthn/authenticate/finish', 'POST');

    await identityProxy(c, () => Promise.resolve());
    const cookie = captured.headers.find(([name]) => name === 'set-cookie')?.[1] ?? '';

    // `__Host-` is refused by a browser unless all three hold, and the prefix
    // is what stops a sibling subdomain setting this cookie.
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('Path=/');
    expect(cookie).not.toContain('Domain=');
    // Strict, because a session cookie sent on a top-level navigation from
    // another site is the shape CSRF needs.
    expect(cookie).toContain('SameSite=Strict');
  });

  it('adds the internal token, and never returns it', async () => {
    upstream({ slug: 'acme' });
    const { c, captured } = context('/api/identity/tenant/acme');

    await identityProxy(c, () => Promise.resolve());

    const sent = (globalThis.fetch as unknown as { mock: { calls: [URL, RequestInit][] } }).mock
      .calls[0];
    const headers = new Headers(sent?.[1]?.headers);
    expect(headers.has('x-internal-token')).toBe(true);
    expect(captured.headers.map(([n]) => n.toLowerCase())).not.toContain('x-internal-token');
  });

  it('never forwards the browser cookie upstream', async () => {
    // Identity has no use for it and every reason not to see it.
    upstream({ slug: 'acme' });
    const c = {
      req: {
        path: '/api/identity/tenant/acme',
        method: 'GET',
        url: 'http://auth.staging.app.kithena.com/api/identity/tenant/acme',
        raw: {
          headers: new Headers({ cookie: '__Host-kithena_session=leaked' }),
          arrayBuffer: () => new ArrayBuffer(0),
        },
      },
      header: () => undefined,
      json: () => ({}),
      body: () => ({}),
    };

    await identityProxy(c as unknown as Ctx, () => Promise.resolve());

    const sent = (globalThis.fetch as unknown as { mock: { calls: [URL, RequestInit][] } }).mock
      .calls[0];
    expect(new Headers(sent?.[1]?.headers).has('cookie')).toBe(false);
  });

  it('rewrites the public prefix to the internal one', async () => {
    upstream({ slug: 'acme' });
    const { c } = context('/api/identity/tenant/acme');

    await identityProxy(c, () => Promise.resolve());

    const sent = (globalThis.fetch as unknown as { mock: { calls: [URL, RequestInit][] } }).mock
      .calls[0];
    expect(String(sent?.[0])).toContain('/api/internal/tenant/acme');
  });

  it('passes a response with no session straight through', async () => {
    upstream({ slug: 'acme' }, 404);
    const { c, captured } = context('/api/identity/tenant/acme');

    await identityProxy(c, () => Promise.resolve());

    expect(captured.json?.status).toBe(404);
    expect(captured.headers.find(([n]) => n === 'set-cookie')).toBeUndefined();
  });

  it('leaves everything that is not an identity call to the app', async () => {
    upstream({});
    const { c } = context('/login');
    let reached = false;

    await identityProxy(c, () => {
      reached = true;
      return Promise.resolve();
    });

    expect(reached).toBe(true);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('does not reveal the upstream host when it is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('ECONNREFUSED'))));
    const { c, captured } = context('/api/identity/tenant/acme');

    await identityProxy(c, () => Promise.resolve());

    expect(captured.json?.status).toBe(502);
    expect(JSON.stringify(captured.json?.body)).not.toContain('localhost');
  });
});

/*
 * The proxy forwards with a service token attached, so what it is willing to
 * forward *is* the public API of the internal one.
 *
 * It used to forward everything under `/api/identity/`. That published the whole
 * internal surface to the internet with credentials this server supplied:
 * `admin/tenants` listed every customer and the work email of every account at
 * any of them, and a `POST` to `admin/tenants/<id>/invitations` minted an
 * enrolment token for an address of the caller's choosing — account takeover at
 * any tenant, from a browser, with no session.
 *
 * These are the tests that keep it an allowlist. A prefix grows silently every
 * time identity gains a route; a list does not.
 */
describe('the identity proxy, on what it will not forward', () => {
  const forbidden: [string, string][] = [
    ['/api/identity/admin/tenants', 'GET'],
    ['/api/identity/admin/tenants/4f59e318-7e25-4e3b-865a-dc813866ef52', 'GET'],
    ['/api/identity/admin/tenants/4f59e318-7e25-4e3b-865a-dc813866ef52/invitations', 'POST'],
    ['/api/identity/admin/tenants/4f59e318-7e25-4e3b-865a-dc813866ef52', 'PATCH'],
    ['/api/identity/handoff/issue', 'POST'],
    ['/api/identity/handoff/redeem', 'POST'],
    ['/api/identity/session', 'POST'],
    ['/api/identity/session/revoke', 'POST'],
    ['/api/identity/operator/begin', 'POST'],
    ['/api/identity/operator/session', 'POST'],
    // Removed with the flow that used them. Listed so the allowlist cannot
    // quietly regain a route nothing calls any more.
    ['/api/identity/webauthn/replace/begin', 'POST'],
    ['/api/identity/webauthn/replace/finish', 'POST'],
  ];

  it.each(forbidden)('refuses %s %s without calling identity', async (path, method) => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { c, captured } = context(path, method);

    await identityProxy(c, () => Promise.resolve());

    expect(captured.json?.status).toBe(404);
    // The refusal must happen *before* the request, or the token has already
    // been spent on it and only the response is being withheld.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('still forwards the routes the sign-in pages actually use', async () => {
    const allowed: [string, string][] = [
      ['/api/identity/tenant/acme', 'GET'],
      ['/api/identity/enrolment/status', 'POST'],
      ['/api/identity/enrolment/recover', 'POST'],
      ['/api/identity/webauthn/authenticate/begin', 'POST'],
      ['/api/identity/webauthn/authenticate/finish', 'POST'],
      ['/api/identity/webauthn/register/begin', 'POST'],
      ['/api/identity/webauthn/register/finish', 'POST'],
    ];

    for (const [path, method] of allowed) {
      upstream({ ok: true });
      const { c, captured } = context(path, method);
      await identityProxy(c, () => Promise.resolve());
      expect(captured.json?.status, `${method} ${path}`).toBe(200);
    }
  });

  /*
   * The method is part of the rule. A route that gains a `DELETE` upstream must
   * not gain one here just because its path is on the list.
   */
  it('refuses an allowed path on a method it does not allow', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { c, captured } = context('/api/identity/tenant/acme', 'DELETE');

    await identityProxy(c, () => Promise.resolve());

    expect(captured.json?.status).toBe(404);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  /*
   * The slug is matched, not trusted. Without that, the one parameterised route
   * is a way to walk into every route beside it.
   */
  it('refuses a tenant slug that tries to leave its segment', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    for (const slug of ['../admin/tenants', 'acme/../../admin/tenants', 'ACME', 'a'.repeat(64)]) {
      const { c, captured } = context(`/api/identity/tenant/${slug}`, 'GET');
      await identityProxy(c, () => Promise.resolve());
      expect(captured.json?.status, slug).toBe(404);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
