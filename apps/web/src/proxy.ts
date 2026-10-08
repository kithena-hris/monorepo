import { NextResponse, type NextRequest } from 'next/server';

import { AREAS, remoteBase, remotePath, type Area } from './lib/remotes';
import { resolveTenant, type Tenant } from './lib/tenant';
import { RETURN_COOKIE, SESSION_COOKIE } from './lib/session-cookie';

/**
 * Tenant resolution, before anything else runs.
 *
 * This is the only place `x-tenant-id` is written, and the first thing it does
 * is delete any that arrived. A client that can set that header can read
 * another company's data, so the rule is that inbound copies do not survive
 * contact with this file — not "are overwritten later", deleted here, before
 * any branch that might return early.
 */

/** The part of the hostname after the tenant label. Differs per environment. */
const HOST_SUFFIX = process.env['TENANT_HOST_SUFFIX'] ?? '';

/**
 * Pages a signed-out person is allowed to reach.
 *
 * Sign-in itself, the callback that lands them here afterwards, the page that
 * explains a sign-in which did not finish, and sign-out — which has to work
 * *because* it is how a stale cookie gets cleared. And a wall kiosk
 * (`/kiosk/<id>` and its service worker), which has no session at all: it
 * presents its own device token, which Time Off checks. And the phone app's
 * `/api/mobile/*`, which carries a bearer rather than a cookie and checks it
 * itself. Anything else redirects.
 */
const PUBLIC_PATH =
  /^\/(login|recover|signed-out|auth\/|api\/(session|recover|mobile\/)|kiosk\/|kiosk-sw\.js$)/;

/**
 * Resolved tenants, briefly.
 *
 * Every request would otherwise cost a lookup to learn something that changes
 * when a customer signs up. Thirty seconds is short enough that a new tenant is
 * reachable while you are still looking at the signup screen, and long enough
 * that a burst of requests from one company costs one query.
 *
 * Only *positive* results are cached. Caching a miss would let one request for
 * a not-yet-created tenant keep it unreachable, and would give anyone probing
 * for valid slugs a free way to pin the answer.
 */
const CACHE_MS = 30_000;
const cache = new Map<string, { tenant: Tenant; at: number }>();

async function lookup(slug: string): Promise<Tenant | null> {
  const hit = cache.get(slug);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.tenant;

  // The registry lives behind a route handler rather than a direct database
  // client: proxy code runs in a constrained runtime, and a pg connection pool
  // per edge invocation is the wrong shape even where it is possible.
  const response = await fetch(
    `${process.env['INTERNAL_API_URL'] ?? ''}/api/internal/tenant/${encodeURIComponent(slug)}`,
    { headers: { 'x-internal-token': process.env['INTERNAL_API_TOKEN'] ?? '' } },
  ).catch(() => null);

  if (!response?.ok) return null;

  const tenant: unknown = await response.json().catch(() => null);
  if (!isTenant(tenant)) return null;

  cache.set(slug, { tenant, at: Date.now() });
  return tenant;
}

function isTenant(value: unknown): value is Tenant {
  if (value === null || typeof value !== 'object') return false;
  const { id, slug, status } = value as Record<string, unknown>;
  return (
    typeof id === 'string' &&
    typeof slug === 'string' &&
    (status === 'active' || status === 'suspended' || status === 'closed')
  );
}

/**
 * A remote's files, from the company's own host (`remotePath`): `/_people/*`,
 * `/_timeoff/*`. A remote that is not configured has none.
 *
 * Forwarded as asked, so `If-None-Match` reaches the remote and its 304,
 * `Cache-Control`, `ETag` and `nosniff` come back as it sent them. Nothing
 * of the company's goes with it: no cookie, no tenant, and no lookup, because
 * the remote is the same public code for everybody. The path stays on the
 * remote's origin whatever it holds: it is joined onto a URL, never parsed as one.
 */
function remoteFile(request: NextRequest, area: Area): NextResponse {
  const remote = remoteBase(area);
  const base = new URL(remote);
  const to = new URL(
    `${remote}${request.nextUrl.pathname.slice(remotePath(area).length)}${request.nextUrl.search}`,
  );
  // Never anywhere but the remote, whatever the path held.
  if (to.origin !== base.origin) return new NextResponse(null, { status: 400 });
  const headers = new Headers(request.headers);
  headers.delete('cookie');
  headers.delete('authorization');
  return NextResponse.rewrite(to, { request: { headers } });
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const files = Object.values(AREAS).find((a) =>
    request.nextUrl.pathname.startsWith(`${remotePath(a)}/`),
  );
  if (files !== undefined) return remoteFile(request, files);

  const headers = new Headers(request.headers);

  // First, unconditionally. Anything below may return early, and every one of
  // those paths must also be a path where a spoofed header is already gone.
  headers.delete('x-tenant-id');
  headers.delete('x-tenant-slug');

  const { tenant } = await resolveTenant(request.headers.get('host'), HOST_SUFFIX, lookup);

  if (!tenant) {
    // A 404, not a redirect to a marketing page. A redirect distinguishes
    // "no such tenant" from "not found", which tells someone probing slugs
    // which companies are customers.
    return new NextResponse(null, { status: 404 });
  }

  headers.set('x-tenant-id', tenant.id);
  headers.set('x-tenant-slug', tenant.slug);

  /*
   * Nobody sees a company's pages without a session cookie.
   *
   * Every page here belongs to somebody, so a person who is not signed in has
   * nothing to be shown and should be asked to sign in rather than served an
   * empty frame — including on a page that has not been written yet, which is
   * the case this exists for. A guard added per page is a guard the next page
   * forgets.
   *
   * **A cookie-presence check, not a session lookup.** `docs/authentication.md`
   * is explicit that the session must not be read here: this runs on every
   * request including assets, and a lookup per request is the wrong shape. This
   * asks only whether a cookie exists, which is free and needs no network.
   *
   * So it is a *convenience*, not the authorisation. A forged or expired cookie
   * gets past this and is then refused by `currentPerson()`, which does the real
   * check on the server, per render. Nothing here is load-bearing for security,
   * and it is written this way so nobody later mistakes it for the thing that
   * is.
   */
  if (!PUBLIC_PATH.test(request.nextUrl.pathname) && !request.cookies.has(SESSION_COOKIE)) {
    // A view as somebody whose cookie expired with it (thirty minutes): put
    // the administrator's own session back rather than asking them to sign in.
    const to = request.cookies.has(RETURN_COOKIE) ? '/auth/view-as/end' : '/login';
    return NextResponse.redirect(new URL(to, request.url));
  }

  return NextResponse.next({ request: { headers } });
}

export const config = {
  // Static assets carry no tenant data and are served from the same build for
  // everyone, so paying a lookup for each is cost without a decision.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/internal).*)'],
};
