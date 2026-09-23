import { eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { moduleEntitlements, type ModuleEntitlement } from '@kithena/contracts';

import { tenantSettings } from './tables.js';

/**
 * The modules the company bought, as the back office last said (PEO-114).
 *
 * A copy, kept from `identity.tenant.entitlements_changed`, because the
 * registry is `platform.tenant` and People reads no other service's tables
 * (20260924230100). Null until the back office records a list: the company
 * then has the deployment's, which is what the caller forwards.
 */

/** Keep the list, unless a later one is already kept. True when it was written. */
export async function rememberEntitlements(
  tx: PostgresJsDatabase,
  tenantId: string,
  entitlements: readonly ModuleEntitlement[],
  asOf: string,
): Promise<boolean> {
  const set = { entitlements: [...entitlements], entitlementsAsOf: new Date(asOf) };
  const rows = await tx
    .insert(tenantSettings)
    .values({ tenantId, defaultTimeZone: 'Etc/UTC', cohortMinimum: 10, ...set })
    .onConflictDoUpdate({
      target: tenantSettings.tenantId,
      set,
      setWhere: sql`${tenantSettings.entitlementsAsOf} IS NULL OR ${tenantSettings.entitlementsAsOf} < ${asOf}::timestamptz`,
    })
    .returning({ tenantId: tenantSettings.tenantId });
  return rows.length > 0;
}

/** The recorded list, or null when the back office never recorded one. */
export async function recordedEntitlements(
  tx: PostgresJsDatabase,
  tenantId: string,
): Promise<ModuleEntitlement[] | null> {
  const rows = await tx
    .select({ entitlements: tenantSettings.entitlements })
    .from(tenantSettings)
    .where(eq(tenantSettings.tenantId, tenantId))
    .limit(1);
  const found = rows[0]?.entitlements;
  return found == null ? null : moduleEntitlements(found);
}
