import type { IncomingMessage, ServerResponse } from 'node:http';
import { ModuleEntitlement, ModuleRoleReport } from '@kithena/contracts';

import { presentsInternalToken, readJsonBody } from '../../shared/internal-token.js';

/**
 * A module reporting who holds its administrator roles:
 * `PUT /api/internal/tenants/<id>/module-roles/<entitlement>`, a
 * `ModuleRoleReport`.
 *
 * The back office shows what it set (`platform.tenant_administrator`) beside
 * what the module actually has, and must learn the second without importing
 * the module or reading its schema. The module already calls identity over
 * internal HTTP for the account directory, so it reports here the same way,
 * with the same secret; identity keeps the newest report per module and the
 * company detail carries it.
 *
 * Each module presents its own token: a module can only report its own
 * roles. A module with no token configured cannot report at all.
 */
const PATH =
  /^\/api\/internal\/tenants\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/module-roles\/([a-z.]+)$/i;

export interface ModuleRoleRoutesDeps {
  /** Module → the secret it presents. */
  readonly tokens: Readonly<Partial<Record<ModuleEntitlement, string>>>;
  /** Keep the report unless a newer one is kept; false when the company does not exist. */
  readonly record: (
    tenantId: string,
    entitlement: ModuleEntitlement,
    report: ModuleRoleReport,
  ) => Promise<boolean>;
}

export function moduleRoleRoutes({ tokens, record }: ModuleRoleRoutesDeps) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<boolean> => {
    const match = PATH.exec((request.url ?? '').split('?')[0] ?? '');
    if (!match) return false;

    if (request.method !== 'PUT') {
      response.writeHead(405, { allow: 'PUT' }).end();
      return true;
    }
    const entitlement = ModuleEntitlement.safeParse(match[2]);
    const token = entitlement.success ? tokens[entitlement.data] : undefined;
    if (!entitlement.success || token === undefined || !presentsInternalToken(request, token)) {
      response.writeHead(401).end();
      return true;
    }

    const report = ModuleRoleReport.safeParse(await readJsonBody(request, 1024 * 1024));
    if (!report.success) {
      response.writeHead(400).end();
      return true;
    }
    const known = await record(match[1] ?? '', entitlement.data, report.data);
    response.writeHead(known ? 204 : 404).end();
    return true;
  };
}
