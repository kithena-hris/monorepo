import type { IncomingMessage, ServerResponse } from 'node:http';

import { DEFAULT_THEME_ID } from '@kithena/contracts';

import { presentsInternalToken, readJsonBody } from '../../shared/internal-token.js';
import type { InviteAccount } from '../application/invite-account.js';
import type { AmendTenant } from '../application/amend-tenant.js';
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

/**
 * `/api/internal/admin/tenants/<uuid>/invitations`, the same shape one segment
 * longer.
 *
 * A collection under the tenant rather than a top-level `/invitations` with the
 * company in the body, because an invitation has no meaning outside one — and
 * because the tenant id in the path is what an audit log reads without having
 * to parse a body.
 */
const INVITATIONS =
  /^\/api\/internal\/admin\/tenants\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/invitations$/i;

/**
 * Deliberately not a full RFC 5322 grammar; see the messaging service's
 * `toAddress` for why one is neither achievable nor useful. This is the
 * boundary check — enough shape that a typo is refused before an account is
 * created against it — and messaging re-checks it before spending a send.
 */
const EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

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
  readonly listTenants: (page: { limit: number; cursor: TenantCursor | null }) => Promise<{
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
  readonly amend: AmendTenant;
  readonly invite: InviteAccount;
  readonly internalToken: string;
}

export function adminRoutes({
  listTenants,
  tenantDetail,
  provision,
  amend,
  invite,
  internalToken,
}: AdminRoutesDeps) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<boolean> => {
    const path = (request.url ?? '').split('?')[0] ?? '';
    const detail = DETAIL.exec(path);
    const invitations = INVITATIONS.exec(path);
    if (path !== LIST && !detail && !invitations) return false;

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

    if (invitations) {
      if (request.method !== 'POST') {
        response.writeHead(405, { allow: 'POST' }).end();
        return true;
      }

      const asked = (await readJsonBody(request)) as Record<string, unknown> | null;
      if (asked === null) return json(400, {});

      const email = typeof asked['email'] === 'string' ? asked['email'].trim() : '';
      if (email === '' || email.length > 254 || !EMAIL.test(email)) {
        return json(422, {
          code: 'EMAIL_MALFORMED',
          message: 'That is not an address an invitation can be sent to',
          path: ['email'],
        });
      }

      const optional = (key: string): string | undefined =>
        typeof asked[key] === 'string' && asked[key] !== '' ? asked[key] : undefined;

      const invited = await invite({
        tenantId: invitations[1] ?? '',
        email,
        // The operator acting is a back-office operator, not an account inside
        // the tenant, so there is nobody in `platform.account` to name here.
        // `issued_by` references that table; a back-office identity in it would
        // be an account at a customer we do not work for.
        issuedBy: null,
        /*
         * Passed through unchecked on purpose. The shape of a calendar date and
         * whether a zone exists are rules about what an employment record *is*,
         * so they live in `checkEmployment` — a rule enforced in one of four
         * transports is a rule that leaks the day a SCIM push arrives.
         *
         * Absent means "today, in UTC", decided there rather than here for the
         * same reason.
         */
        ...(optional('employmentStart') === undefined
          ? {}
          : { employmentStart: optional('employmentStart') }),
        ...(optional('timeZone') === undefined ? {} : { timeZone: optional('timeZone') }),
        ...(asked['secondChannel'] === 'known_value'
          ? { secondChannel: 'known_value' as const }
          : {}),
      });

      if (!invited.ok) {
        return json(422, {
          code: invited.error.code,
          message: invited.error.message,
          path: invited.error.path ?? [],
        });
      }

      // 201: an account and a live enrolment token now exist. Whether the
      // message arrived is reported inside, because it is a different question
      // and the operator has to be able to see the answer is no.
      return json(201, invited.value);
    }

    if (detail) {
      const tenantId = detail[1] ?? '';

      /*
       * PATCH by name and PUT by behaviour: the body carries every editable
       * field and replaces all of them.
       *
       * A genuine partial update — apply the keys that are present, leave the
       * rest — reads well and is the wrong contract for a form. `logoUrl: null`
       * and "no logoUrl key" are different intentions, and a client that
       * serialises a cleared field as an absent one silently loses the
       * clearing. Requiring the whole object makes "remove the logo" something
       * the caller has to state.
       *
       * It is not PUT because the resource has fields this body cannot set —
       * the slug, the people, the status — and a PUT that quietly preserves
       * most of the resource is a worse lie than a PATCH that replaces a
       * documented subset.
       */
      if (request.method === 'PATCH') {
        const asked = (await readJsonBody(request)) as Record<string, unknown> | null;
        if (asked === null) return json(400, {});

        const text = (key: string): string =>
          typeof asked[key] === 'string' ? asked[key] : '';
        const orNull = (key: string): string | null =>
          typeof asked[key] === 'string' && asked[key] !== '' ? asked[key] : null;

        const address =
          asked['address'] !== null && typeof asked['address'] === 'object'
            ? (asked['address'] as Record<string, unknown>)
            : {};
        const field = (key: string): string =>
          typeof address[key] === 'string' ? address[key] : '';
        const fieldOrNull = (key: string): string | null =>
          typeof address[key] === 'string' && address[key] !== '' ? address[key] : null;

        const amended = await amend(tenantId, {
          displayName: text('displayName'),
          themeId: text('themeId'),
          logoUrl: orNull('logoUrl'),
          coverImageUrl: orNull('coverImageUrl'),
          // Absent means public. The flag is the exception a company opts into,
          // and defaulting a missing value to "hidden" would quietly un-brand
          // every company whose client forgot the field.
          brandingPublic: asked['brandingPublic'] !== false,
          address: {
            country: field('country').toUpperCase(),
            line1: field('line1'),
            line2: fieldOrNull('line2'),
            city: field('city'),
            subdivision: fieldOrNull('subdivision'),
            postcode: fieldOrNull('postcode'),
          },
        });

        if (!amended.ok) {
          return json(amended.error.code === 'TENANT_UNKNOWN' ? 404 : 422, {
            code: amended.error.code,
            message: amended.error.message,
            path: amended.error.path ?? [],
          });
        }

        // The stored company, re-read rather than echoed. The caller renders
        // what came back, and echoing the request would show it its own
        // uncommitted idea of the row.
        const found = await tenantDetail(tenantId);
        return found ? json(200, found) : json(404, {});
      }

      if (request.method !== 'GET') {
        response.writeHead(405, { allow: 'GET, PATCH' }).end();
        return true;
      }
      const found = await tenantDetail(tenantId);
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
