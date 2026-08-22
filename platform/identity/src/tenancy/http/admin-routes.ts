import type { IncomingMessage, ServerResponse } from 'node:http';

import { DEFAULT_THEME_ID } from '@kithena/contracts';

import { presentsInternalToken, readJsonBody } from '../../shared/internal-token.js';
import type { ProvisionTenant } from '../application/provision-tenant.js';

/**
 * What the back-office needs from the registry.
 *
 * Reads and writes `platform.*` only. It does not reach into a module's schema
 * for an employee count, and the reason is not tidiness: a back-office that
 * queries `people.*` stops working the day a customer runs Time Off alone
 * against Workday and there is no People schema to query. Counts arrive later
 * as a projection built from events.
 */
const LIST = '/api/internal/admin/tenants';

/**
 * `/api/internal/admin/tenants/<uuid>`, matched rather than parsed with a
 * router. One dynamic segment does not justify a dependency, and an anchored
 * pattern is the difference between a path that must be a uuid and one that
 * merely starts like a route.
 */
const DETAIL =
  /^\/api\/internal\/admin\/tenants\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export interface TenantPerson {
  readonly id: string;
  readonly email: string;
  readonly status: string;
  readonly createdAt: string;
}

export interface TenantDetail {
  readonly id: string;
  readonly slug: string;
  readonly displayName: string;
  readonly status: string;
  readonly createdAt: string;
  readonly themeId: string | null;
  readonly logoUrl: string | null;
  readonly coverImageUrl: string | null;
  readonly address: {
    readonly country: string;
    readonly line1: string;
    readonly line2: string | null;
    readonly city: string;
    readonly subdivision: string | null;
    readonly postcode: string | null;
  } | null;
  readonly people: readonly TenantPerson[];
}

export interface TenantCursor {
  readonly createdAt: string;
  readonly id: string;
}

export interface AdminRoutesDeps {
  readonly listTenants: (page: {
    limit: number;
    cursor: TenantCursor | null;
  }) => Promise<{
    tenants: readonly {
      id: string;
      slug: string;
      displayName: string;
      status: string;
      createdAt: string;
      admins: number;
      pendingInvites: number;
    }[];
    nextCursor: TenantCursor | null;
  }>;
  readonly tenantDetail: (id: string) => Promise<TenantDetail | null>;
  readonly provision: ProvisionTenant;
  readonly internalToken: string;
}

export function adminRoutes({
  listTenants,
  tenantDetail,
  provision,
  internalToken,
}: AdminRoutesDeps) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<boolean> => {
    const path = (request.url ?? '').split('?')[0] ?? '';
    const detail = DETAIL.exec(path);
    if (path !== LIST && !detail) return false;

    if (!presentsInternalToken(request, internalToken)) {
      response.writeHead(401).end();
      return true;
    }

    const json = (status: number, body: unknown): true => {
      response
        .writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        .end(JSON.stringify(body));
      return true;
    };

    if (detail) {
      if (request.method !== 'GET') {
        response.writeHead(405, { allow: 'GET' }).end();
        return true;
      }
      const found = await tenantDetail(detail[1] ?? '');
      return found ? json(200, found) : json(404, {});
    }

    if (request.method === 'GET') {
      const url = new URL(request.url ?? '/', 'http://placeholder');

      // Clamped, not trusted. `?limit=1000000` on an unbounded query is a
      // denial of service written by the caller, and the page it would return
      // is not one anybody reads.
      const asked = Number(url.searchParams.get('limit') ?? '50');
      const limit = Number.isFinite(asked) ? Math.min(Math.max(Math.trunc(asked), 1), 100) : 50;

      // The cursor is opaque to the caller: base64 of the pair it must not
      // have to know the shape of. Unparseable means the first page rather
      // than an error — a stale bookmark should show a list, not a 400.
      const raw = url.searchParams.get('cursor');
      let cursor: TenantCursor | null = null;
      if (raw !== null) {
        try {
          const decoded: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
          if (
            typeof decoded === 'object' &&
            decoded !== null &&
            typeof (decoded as TenantCursor).createdAt === 'string' &&
            typeof (decoded as TenantCursor).id === 'string'
          ) {
            cursor = decoded as TenantCursor;
          }
        } catch {
          cursor = null;
        }
      }

      const page = await listTenants({ limit, cursor });
      return json(200, {
        tenants: page.tenants,
        nextCursor:
          page.nextCursor === null
            ? null
            : Buffer.from(JSON.stringify(page.nextCursor)).toString('base64url'),
      });
    }
    if (request.method !== 'POST') {
      response.writeHead(405, { allow: 'GET, POST' }).end();
      return true;
    }

    const body = (await readJsonBody(request)) as Record<string, unknown> | null;
    if (body === null) return json(400, {});

    const str = (key: string): string => (typeof body[key] === 'string' ? body[key] : '');
    const orNull = (key: string, source: Record<string, unknown> = body): string | null => {
      const value = source[key];
      return typeof value === 'string' && value !== '' ? value : null;
    };

    const address =
      typeof body['address'] === 'object' && body['address'] !== null
        ? (body['address'] as Record<string, unknown>)
        : {};

    const result = await provision({
      slug: str('slug'),
      displayName: str('displayName'),
      admins: Array.isArray(body['admins'])
        ? body['admins'].filter((a): a is string => typeof a === 'string')
        : [],
      // A caller that omits the theme gets the default rather than a refusal.
      // The field is a preference, and the wizard's last step is the one a
      // hurried operator is most likely to skip.
      themeId: typeof body['themeId'] === 'string' ? body['themeId'] : DEFAULT_THEME_ID,
      logoUrl: orNull('logoUrl'),
      coverImageUrl: orNull('coverImageUrl'),
      address: {
        country: typeof address['country'] === 'string' ? address['country'] : '',
        line1: typeof address['line1'] === 'string' ? address['line1'] : '',
        line2: orNull('line2', address),
        city: typeof address['city'] === 'string' ? address['city'] : '',
        subdivision: orNull('subdivision', address),
        postcode: orNull('postcode', address),
      },
    });

    if (!result.ok) {
      // The back-office is an authenticated surface, so it gets the real
      // reason: the operator has to know whether the label was malformed,
      // reserved or already taken, and none of that tells a stranger anything
      // because no stranger reaches here. `path` travels too, so the wizard can
      // put the message under the input it belongs to rather than at the top.
      return json(422, {
        code: result.error.code,
        message: result.error.message,
        path: result.error.path ?? [],
      });
    }

    return json(201, result.value);
  };
}
