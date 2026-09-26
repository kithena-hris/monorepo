import type * as z from 'zod';
import type { ModuleRoleReport } from '@kithena/contracts';
import type { Clock } from '@kithena/domain-kit';
import { logger } from '@kithena/telemetry';

import { ADMINISTRATOR_ROLES } from '../domain/access/roles.js';
import { drizzleRoleStore } from './drizzle-role-store.js';
import type { InTenantTransaction } from './unit-of-work.js';

/**
 * Tell identity who holds People's administrator roles in one tenant:
 * `PUT /api/internal/tenants/<id>/module-roles/module.people`, a
 * `ModuleRoleReport`.
 *
 * The back office shows what it set beside what People actually has, and may
 * not read People's tables or import it; identity keeps the newest report.
 * Sent after a role change has committed (the consumer, on `people.role.*`)
 * and for every tenant at boot and daily (the background job), so a report
 * lost to an absent identity is overtaken by the next one.
 *
 * Never throws and never blocks a role change: People boots and grants alone,
 * and a failure here only leaves the back office's view older than it could be.
 */
export type ReportRoles = (tenantId: string) => Promise<void>;

export function httpRoleReport(config: {
  readonly baseUrl: string;
  readonly token: string;
  readonly inTenant: InTenantTransaction;
  readonly clock: Clock;
  readonly timeoutMs?: number;
}): ReportRoles {
  const store = drizzleRoleStore();
  return async (tenantId) => {
    try {
      const report = await config.inTenant(tenantId, async ({ tx }) => {
        // Read under the role lock, so the snapshot is one moment's.
        await store.lock(tx, tenantId);
        const asOf: string = config.clock.instant();
        const held = await store.holdings(tx, tenantId);
        return {
          asOf,
          administratorRoles: [...ADMINISTRATOR_ROLES],
          holders: [...held]
            .map(([accountId, roles]) => ({
              accountId,
              roles: ADMINISTRATOR_ROLES.filter((role) => roles.has(role)),
            }))
            .filter((holder) => holder.roles.length > 0)
            .toSorted((a, b) => a.accountId.localeCompare(b.accountId)),
        } satisfies z.input<typeof ModuleRoleReport>;
      });
      const response = await fetch(
        new URL(`/api/internal/tenants/${tenantId}/module-roles/module.people`, config.baseUrl),
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json', 'x-internal-token': config.token },
          body: JSON.stringify(report),
          signal: AbortSignal.timeout(config.timeoutMs ?? 10_000),
        },
      );
      if (!response.ok) {
        logger.warn({ tenantId, status: response.status }, 'identity refused the role report');
      }
    } catch (error) {
      logger.warn({ tenantId, err: error }, 'role report not sent');
    }
  };
}

/** From `IDENTITY_URL` and `PEOPLE_IDENTITY_TOKEN` (else `INTERNAL_API_TOKEN`); null without both. */
export function roleReportFrom(
  env: NodeJS.ProcessEnv,
  inTenant: InTenantTransaction,
  clock: Clock,
): ReportRoles | null {
  const baseUrl = env['IDENTITY_URL'];
  const token = env['PEOPLE_IDENTITY_TOKEN'] ?? env['INTERNAL_API_TOKEN'];
  if (!baseUrl || !token) return null;
  return httpRoleReport({ baseUrl, token, inTenant, clock });
}
