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

export default defineServerConfig({
  middlewares: [{ name: 'identity-proxy', handler: identityProxy }],
});
