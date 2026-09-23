import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { char, pgSchema, smallint, text, timestamp, uuid, primaryKey } from 'drizzle-orm/pg-core';

/**
 * Idempotency keys for REST writes.
 *
 * A key, the hash of the request it was first used with, and the resource that
 * request produced — never the response body, which would be a copy of
 * somebody's record kept for no reason. A replay reads the resource again,
 * through the same authorization as any read.
 *
 * ponytail: rows are never pruned. Add a retention sweep when the table is
 * big enough to notice; 24 hours is the window integrators are told about.
 */

export const idempotencyKey = pgSchema('people').table(
  'idempotency_key',
  {
    tenantId: uuid('tenant_id').notNull(),
    key: text('key').notNull(),
    requestHash: char('request_hash', { length: 64 }).notNull(),
    status: smallint('status').notNull(),
    resourceId: uuid('resource_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.key] })],
);

export interface StoredKey {
  readonly requestHash: string;
  readonly status: number;
  readonly resourceId: string;
}

export interface IdempotencyStore {
  find(tx: PostgresJsDatabase, tenantId: string, key: string): Promise<StoredKey | null>;
  /** False when another request committed this key first. */
  save(tx: PostgresJsDatabase, tenantId: string, key: string, stored: StoredKey): Promise<boolean>;
}

export function drizzleIdempotency(): IdempotencyStore {
  return {
    async find(tx, tenantId, key) {
      const rows = await tx
        .select({
          requestHash: idempotencyKey.requestHash,
          status: idempotencyKey.status,
          resourceId: idempotencyKey.resourceId,
        })
        .from(idempotencyKey)
        .where(and(eq(idempotencyKey.tenantId, tenantId), eq(idempotencyKey.key, key)))
        .limit(1);
      return rows[0] ?? null;
    },

    async save(tx, tenantId, key, stored) {
      // ON CONFLICT DO NOTHING rather than catching 23505: a unique violation
      // aborts the transaction, and this one still has to be rolled back
      // deliberately by the caller rather than by accident.
      const inserted = await tx
        .insert(idempotencyKey)
        .values({ tenantId, key, ...stored })
        .onConflictDoNothing()
        .returning({ key: idempotencyKey.key });
      return inserted.length === 1;
    },
  };
}

export function inMemoryIdempotency(): IdempotencyStore {
  const keys = new Map<string, StoredKey>();
  return {
    find: (_tx, tenantId, key) => Promise.resolve(keys.get(`${tenantId}:${key}`) ?? null),
    save(_tx, tenantId, key, stored) {
      if (keys.has(`${tenantId}:${key}`)) return Promise.resolve(false);
      keys.set(`${tenantId}:${key}`, stored);
      return Promise.resolve(true);
    },
  };
}
