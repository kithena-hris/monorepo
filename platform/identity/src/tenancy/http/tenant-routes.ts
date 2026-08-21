import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { logger } from '@kithena/telemetry';

import type { ResolveTenant } from '../application/resolve-tenant.js';

/**
 * The lookup the tenant proxy makes on a cache miss.
 *
 * It is reached before any user is known, from a runtime that cannot hold a
 * connection pool, which is why it exists as a route at all rather than as a
 * direct query from the proxy.
 */

const PREFIX = '/api/internal/tenant/';

/**
 * Constant-time comparison, because the obvious one leaks the token.
 *
 * `a === b` on strings returns as soon as two bytes differ, so the time it
 * takes says how many leading bytes were right, and a few thousand requests
 * turn that into the token. `timingSafeEqual` throws on a length mismatch —
 * which is itself a leak of the length — so the lengths are checked first and
 * the comparison is only reached for equal-length inputs.
 */
function tokenMatches(presented: string, expected: string): boolean {
  if (expected.length === 0) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export interface TenantRoutesDeps {
  readonly resolve: ResolveTenant;
  readonly internalToken: string;
}

/** Handles the route, or returns false so the caller can 404 it. */
export function tenantRoutes({ resolve, internalToken }: TenantRoutesDeps) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<boolean> => {
    const url = request.url ?? '';
    if (!url.startsWith(PREFIX)) return false;

    const presented = request.headers['x-internal-token'];
    if (typeof presented !== 'string' || !tokenMatches(presented, internalToken)) {
      // 401 rather than 404: this endpoint's existence is not a secret, and
      // pretending otherwise makes a misconfigured proxy indistinguishable
      // from a bad slug at exactly the moment someone is debugging one.
      response.writeHead(401).end();
      return true;
    }

    // `decodeURIComponent` throws on a malformed escape, which is a request
    // nobody legitimate makes. It is a bad slug, not a server error.
    let slug: string;
    try {
      slug = decodeURIComponent(url.slice(PREFIX.length).split('?')[0] ?? '');
    } catch {
      response.writeHead(404).end();
      return true;
    }

    const result = await resolve(slug);

    if (!result.ok) {
      // The reason is logged and never sent. Telling a caller that a slug is
      // "suspended" rather than "unknown" tells whoever is probing which
      // companies are customers.
      logger.info({ slug, reason: result.error.path?.[0] }, 'tenant not resolved');
      response.writeHead(404).end();
      return true;
    }

    response
      .writeHead(200, {
        'content-type': 'application/json',
        // A resolved tenant is not cacheable by anything between here and the
        // proxy. The proxy holds its own short-lived cache and is the only
        // thing that should.
        'cache-control': 'no-store',
      })
      .end(JSON.stringify(result.value));
    return true;
  };
}
