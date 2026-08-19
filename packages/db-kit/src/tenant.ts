import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';

/**
 * Tenant isolation is enforced by row-level security, not by remembering to
 * add a WHERE clause. Every transaction sets the tenant from verified token
 * claims; policies read it back with current_setting.
 *
 * There is no code path that opens a connection without going through here.
 */
export async function withTenant<T>(
  db: PostgresJsDatabase,
  tenantId: string,
  fn: (tx: PostgresJsDatabase) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx);
  });
}

/**
 * Escape hatch for migrations and platform jobs. Every call site needs a
 * comment explaining why, and the audit log records it.
 */
export async function withoutTenantScope<T>(
  db: PostgresJsDatabase,
  reason: string,
  fn: (tx: PostgresJsDatabase) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.bypass_reason', ${reason}, true)`);
    return fn(tx);
  });
}
