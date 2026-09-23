import { AsyncLocalStorage } from 'node:async_hooks';
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

/**
 * One tenant, one transaction, one unit of work.
 *
 * The shape is a scope handed to a callback rather than a set of independent
 * closures over a pool, and `invite-account.ts` sets out why at length:
 * `app.tenant_id` is set with `set_config(..., true)`, which is scoped to the
 * transaction that set it. Closures over a *pool* run each statement on
 * whichever connection is free, so the second one arrives on a connection
 * where no tenant was ever set — and row-level security answers that with an
 * empty result or a 42501, neither of which says why.
 *
 * A shape that cannot express "these run together" is a shape where that
 * happens eventually. This one can only express it.
 */

export interface TenantScope {
  /** The transaction every statement in this unit of work runs on. */
  readonly tx: PostgresJsDatabase;
  readonly tenantId: string;
}

export type InTenantTransaction = <T>(
  tenantId: string,
  fn: (scope: TenantScope) => Promise<T>,
) => Promise<T>;

/**
 * Run a unit of work as one tenant.
 *
 * `set_config(..., true)` — the `true` is `is_local`, which ties the setting
 * to this transaction and releases it on commit or rollback. A connection
 * handed back to the pool therefore carries no tenant, which is what stops the
 * next unit of work inheriting the last one's.
 */
export function tenantTransaction(db: PostgresJsDatabase): InTenantTransaction {
  return (tenantId, fn) => {
    const open = shared.getStore();
    if (open?.tenantId === tenantId) {
      // Inside `sharing`: a savepoint on the open transaction, so a refusal
      // or a retried deadlock rolls back this unit alone and the outer commit
      // still decides for everything.
      return open.tx.transaction((tx) => sharing({ tx, tenantId }, () => fn({ tx, tenantId })));
    }
    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
      return fn({ tx, tenantId });
    });
  };
}

const shared = new AsyncLocalStorage<TenantScope>();

/**
 * Run `fn` so that every `tenantTransaction` it opens for the same tenant
 * joins `scope`'s transaction instead of starting its own (PEO-116).
 *
 * For the one caller that must commit a use case together with something the
 * use case does not know about — an Idempotency-Key and the write it keys —
 * when that use case opens its own transactions. Only inside this call; every
 * other unit of work stays its own transaction.
 */
export function sharing<T>(scope: TenantScope, fn: () => Promise<T>): Promise<T> {
  return shared.run(scope, fn);
}
