import { defineServerConfig } from '@modern-js/server-runtime';
import type { MiddlewareHandler } from '@modern-js/server-runtime';

/**
 * The auth origin's server half.
 *
 * This replaces a `tools.devServer.proxy` entry that had two problems, one of
 * them a security defect.
 *
 * The defect: a proxy passes the response straight through, so the session id
 * identity returns reached the browser as JSON. Anything running on this origin
 * could read it — which is the entire property an `HttpOnly` cookie exists to
 * provide, on the one origin where losing it hands over an account.
 *
 * The other problem: `tools.devServer` only runs under `modern dev`, so a built
 * auth origin had no credential injection at all. The origin has never been
 * deployed, which is the only reason that never surfaced.
 *
 * A custom Web Server fixes both, because it is the same server in both modes.
 */

/** Where identity lives. Server-side only; the browser never learns it. */
const IDENTITY = process.env['INTERNAL_API_URL'] ?? 'http://localhost:4100';
const TOKEN = process.env['INTERNAL_API_TOKEN'] ?? '';

const PUBLIC_PREFIX = '/api/identity/';
const INTERNAL_PREFIX = '/api/internal/';

/**
 * Exactly what a browser on this origin may reach, and nothing else.
 *
 * This used to forward *everything* under `/api/identity/` to the matching
 * `/api/internal/` path with the service token attached. That is the entire
 * internal API — `admin/tenants`, `handoff/issue`, `session/revoke`,
 * `operator/*` — published to the internet with credentials supplied by this
 * server. Unauthenticated callers could list every customer, read the work
 * email of every account at any of them, and `POST` an invitation to mint an
 * enrolment token for an address of their choosing, which is account takeover
 * at any tenant.
 *
 * A prefix is not an allowlist. Adding a route to identity silently added it
 * here, so the surface grew with every release and nothing in review looked
 * like a change to this file. The five entries below are what
 * `apps/auth/shell/src` actually calls; anything else is answered 404 without
 * ever reaching identity.
 *
 * Methods are pinned too. `GET` on the registry, `POST` on the ceremonies —
 * so a route that gains a `DELETE` upstream does not gain one here.
 */
const ALLOWED = new Map<string, 'GET' | 'POST'>([
  ['webauthn/authenticate/begin', 'POST'],
  ['webauthn/authenticate/finish', 'POST'],
  ['webauthn/register/begin', 'POST'],
  ['webauthn/register/finish', 'POST'],
]);

/**
 * The one parameterised route: resolving a company by its label.
 *
 * The slug is matched rather than trusted, so `tenant/../admin/tenants` cannot
 * walk out of the segment it is allowed to occupy. It mirrors `TenantSlug`:
 * lowercase letters, digits and hyphens.
 */
const TENANT_ROUTE = /^tenant\/[a-z0-9-]{1,63}$/;

function permitted(path: string, method: string): boolean {
  const route = path.slice(PUBLIC_PREFIX.length);
  if (TENANT_ROUTE.test(route)) return method === 'GET';
  return ALLOWED.get(route) === method;
}

/**
 * The cookie the browser gets instead of the session id.
 *
 * `__Host-` is not decoration: a browser refuses the prefix unless the cookie
 * is `Secure`, carries no `Domain` and is pathed at `/`. That is what stops a
 * sibling subdomain setting it, and `docs/authentication.md` leans on exactly
 * that — `design.kithena.com` and `storybook.kithena.com` are world-readable
 * and share the registrable domain.
 */
const SESSION_COOKIE = '__Host-kithena_session';

/**
 * Headers that must not travel upstream.
 *
 * `cookie` above all: the session cookie belongs to this origin and means
 * nothing to identity, so forwarding it would hand the credential to a service
 * with no use for it. `host` and `content-length` are dropped because fetch
 * sets them itself and a stale length truncates the body.
 */
const STRIPPED = new Set(['cookie', 'host', 'content-length', 'connection']);

/**
 * Hono types a status as a union of every code it knows, and `Response.status`
 * is a plain number. The value is whatever identity replied with and is passed
 * on unchanged, so the cast asserts nothing about it — it only tells the
 * compiler that a number arriving from an HTTP response is an HTTP status.
 */
type HonoStatus = Parameters<Parameters<MiddlewareHandler>[0]['json']>[1];
const asStatus = (status: number): HonoStatus => status as HonoStatus;

function carriesSession(value: unknown): value is { sessionId: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { sessionId?: unknown }).sessionId === 'string'
  );
}

export const identityProxy: MiddlewareHandler = async (c, next) => {
  const path: string = c.req.path;
  if (!path.startsWith(PUBLIC_PREFIX)) return next();

  if (!permitted(path, c.req.method)) {
    // 404, not 403. This endpoint's existence is not something a caller needs
    // confirmed, and an internal route that is deliberately unreachable from a
    // browser should look like it is not there.
    console.warn('[identity-proxy] refused', { path, method: c.req.method });
    return c.json({ message: 'Not found.' }, 404);
  }

  // Built against the identity base rather than by mutating the incoming URL:
  // reassigning `protocol` and `host` on a parsed URL is order-dependent and
  // silently no-ops in cases the spec restricts.
  const search = new URL(c.req.url, 'http://placeholder').search;
  const upstream = new URL(INTERNAL_PREFIX + path.slice(PUBLIC_PREFIX.length) + search, IDENTITY);

  const headers = new Headers();
  for (const [key, value] of c.req.raw.headers as Iterable<[string, string]>) {
    if (!STRIPPED.has(key.toLowerCase())) headers.set(key, value);
  }
  // Added here and nowhere the browser can reach. This is the whole reason the
  // origin needs a server rather than calling identity from the page.
  headers.set('x-internal-token', TOKEN);

  let response: Response;
  try {
    response = await fetch(upstream, {
      method: c.req.method,
      headers,
      ...(c.req.method === 'GET' || c.req.method === 'HEAD'
        ? {}
        : { body: await c.req.raw.arrayBuffer() }),
      redirect: 'manual',
    });
  } catch (error) {
    // Logged with the host, returned without it. `fetch failed` alone does not
    // say which host was unreachable, and that host is exactly what must not
    // reach the browser.
    console.error('[identity-proxy] unreachable', { host: upstream.host, error });
    return c.json({ message: 'The identity service is unreachable.' }, 502);
  }

  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = text === '' ? null : JSON.parse(text);
  } catch {
    return c.body(text, asStatus(response.status));
  }

  if (!carriesSession(payload)) return c.json(payload, asStatus(response.status));

  /*
   * The session id becomes a cookie and leaves the body.
   *
   * Removed, not merely also-set: leaving it in the JSON would make the value
   * both an `HttpOnly` cookie and a string any script on the page can read,
   * which is the same exposure with an extra step.
   */
  const { sessionId, ...rest } = payload;
  c.header(
    'set-cookie',
    [
      `${SESSION_COOKIE}=${sessionId}`,
      'Path=/',
      'HttpOnly',
      'Secure',
      // `Strict`, not `Lax`. A session cookie sent on a top-level navigation
      // from another site is the shape CSRF needs, and nothing about signing
      // in requires arriving from somewhere else.
      'SameSite=Strict',
      'Max-Age=604800',
    ].join('; '),
    { append: true },
  );

  return c.json(rest, asStatus(response.status));
};

/**
 * Minting the code that carries this session to the company's own origin.
 *
 * On the server, and it has to be: the proxy above deliberately takes the
 * session id *out* of the response body and puts it in an `HttpOnly` cookie, so
 * the page that just signed somebody in does not have — and must not have — the
 * value the handoff refers to. A route that asked the browser for it would undo
 * the one property that arrangement exists to buy.
 *
 * So the browser asks for a code, this reads its own cookie, and identity
 * exchanges the pair. What crosses the hostname boundary afterwards is 60
 * seconds of single-use, hash-stored code — never the session.
 */
const HANDOFF_PATH = '/api/auth/handoff';

export const handoffIssuer: MiddlewareHandler = async (c, next) => {
  if (c.req.path !== HANDOFF_PATH) return next();
  if (c.req.method !== 'POST') return c.json({ message: 'Use POST.' }, 405);

  const cookie = c.req.header('cookie') ?? '';
  const sessionId = new RegExp(`(?:^|; )${SESSION_COOKIE}=([^;]+)`).exec(cookie)?.[1];
  if (sessionId === undefined) return c.json({ message: 'Not signed in.' }, 401);

  const body = (await c.req.json().catch(() => null)) as { tenantId?: unknown } | null;
  const tenantId = typeof body?.tenantId === 'string' ? body.tenantId : '';
  if (tenantId === '') return c.json({ message: 'Which company?' }, 400);

  let response: Response;
  try {
    response = await fetch(new URL('/api/internal/handoff/issue', IDENTITY), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-token': TOKEN },
      // The tenant is checked by identity against the session it is handed;
      // a code is only ever redeemable by the company it was issued for.
      body: JSON.stringify({ tenantId, sessionId }),
    });
  } catch (error) {
    console.error('[handoff] unreachable', { host: new URL(IDENTITY).host, error });
    return c.json({ message: 'The identity service is unreachable.' }, 502);
  }

  if (!response.ok) return c.json({ message: 'That sign-in could not be completed.' }, 401);

  const issued = (await response.json()) as { code?: unknown };
  if (typeof issued.code !== 'string') {
    return c.json({ message: 'That sign-in could not be completed.' }, 502);
  }

  return c.json({ code: issued.code });
};

export default defineServerConfig({
  middlewares: [
    // Before the proxy: this path is not under `/api/identity/`, but ordering
    // the specific handler first keeps it that way by construction rather than
    // by the prefix happening not to overlap.
    { name: 'handoff-issuer', handler: handoffIssuer },
    { name: 'identity-proxy', handler: identityProxy },
  ],
});
