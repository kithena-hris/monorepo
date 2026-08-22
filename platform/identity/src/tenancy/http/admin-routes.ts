import type { IncomingMessage, ServerResponse } from 'node:http';

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

export interface AdminRoutesDeps {
  readonly listTenants: () => Promise<
    readonly {
      id: string;
      slug: string;
      displayName: string;
      status: string;
      createdAt: string;
      admins: number;
      pendingInvites: number;
    }[]
  >;
  readonly provision: ProvisionTenant;
  readonly internalToken: string;
}

export function adminRoutes({ listTenants, provision, internalToken }: AdminRoutesDeps) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<boolean> => {
    if ((request.url ?? '').split('?')[0] !== LIST) return false;

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

    if (request.method === 'GET') return json(200, { tenants: await listTenants() });
    if (request.method !== 'POST') {
      response.writeHead(405, { allow: 'GET, POST' }).end();
      return true;
    }

    const body = (await readJsonBody(request)) as Record<string, unknown> | null;
    if (body === null) return json(400, {});

    const result = await provision({
      slug: typeof body['slug'] === 'string' ? body['slug'] : '',
      displayName: typeof body['displayName'] === 'string' ? body['displayName'] : '',
      admins: Array.isArray(body['admins'])
        ? body['admins'].filter((a): a is string => typeof a === 'string')
        : [],
      accentColor: typeof body['accentColor'] === 'string' ? body['accentColor'] : null,
    });

    if (!result.ok) {
      // The back-office is an authenticated surface, so it gets the real
      // reason: the operator has to know whether the label was malformed,
      // reserved or already taken, and none of that tells a stranger anything
      // because no stranger reaches here.
      return json(422, { code: result.error.code, message: result.error.message });
    }

    return json(201, result.value);
  };
}
