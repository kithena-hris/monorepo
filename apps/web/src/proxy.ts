import { NextResponse, type NextRequest } from 'next/server';

import { resolveTenant, type Tenant } from './lib/tenant';

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

export async function proxy(request: NextRequest): Promise<NextResponse> {
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

  return NextResponse.next({ request: { headers } });
}

export const config = {
  // Static assets carry no tenant data and are served from the same build for
  // everyone, so paying a lookup for each is cost without a decision.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/internal).*)'],
};
