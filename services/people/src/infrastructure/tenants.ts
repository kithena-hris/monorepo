import { asc } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { tenant } from './tables.js';

/**
 * The tenants background work runs for (PEO-080).
 *
 * Learnt from the events People consumes rather than read from the platform's
 * registry, which `svc_people` has no grant on. `20260923160000_people_tenant.sql`
 * says why, and why this one table reads without a tenant set.
 */

/** Record the tenant whose transaction `tx` is. Idempotent. */
export async function rememberTenant(tx: PostgresJsDatabase, tenantId: string): Promise<void> {
  await tx.insert(tenant).values({ tenantId }).onConflictDoNothing();
}

/** Every tenant recorded so far. Called outside any tenant transaction. */
export async function knownTenants(db: PostgresJsDatabase): Promise<string[]> {
  const rows = await db
    .select({ tenantId: tenant.tenantId })
    .from(tenant)
    .orderBy(asc(tenant.tenantId));
  return rows.map((r) => r.tenantId);
}
