import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  char,
  jsonb,
  pgSchema,
  smallint,
  text,
  timestamp,
  uuid,
  primaryKey,
} from 'drizzle-orm/pg-core';

/**
 * Idempotency keys for REST writes.
 *
 * A key, the hash of the request it was first used with, and the resource that
 * request produced — never the response body, which would be a copy of
 * somebody's record kept for no reason. A replay reads the resource again,
 * through the same authorization as any read. The one exception is a bulk
 * write's answer (`bulkAnswer`), which cannot be read again from what stands
 * after it, and is kept without anybody's name.
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

/**
 * A bulk write's first answer (bulk hire), kept for its replay: a retry is
 * answered with what the first request did, not with what stands after it.
 * The answer without the names, which a replay reads again (`replayed`).
 * Its id is the resource an idempotency key stores.
 */
export const bulkAnswer = pgSchema('people').table(
  'bulk_answer',
  {
    tenantId: uuid('tenant_id').notNull(),
    id: uuid('id').notNull(),
    answer: jsonb('answer').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] })],
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
  /** Keep a bulk write's first answer under `id`, in the write's transaction. */
  keep(tx: PostgresJsDatabase, tenantId: string, id: string, answer: unknown): Promise<void>;
  /** A kept answer, or null. */
  kept(tx: PostgresJsDatabase, tenantId: string, id: string): Promise<unknown>;
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

    async keep(tx, tenantId, id, answer) {
      await tx.insert(bulkAnswer).values({ tenantId, id, answer });
    },

    async kept(tx, tenantId, id) {
      const rows = await tx
        .select({ answer: bulkAnswer.answer })
        .from(bulkAnswer)
        .where(and(eq(bulkAnswer.tenantId, tenantId), eq(bulkAnswer.id, id)))
        .limit(1);
      return rows[0]?.answer ?? null;
    },
  };
}

export function inMemoryIdempotency(): IdempotencyStore {
  const keys = new Map<string, StoredKey>();
  const answers = new Map<string, unknown>();
  return {
    keep(_tx, tenantId, id, answer) {
      answers.set(`${tenantId}:${id}`, answer);
      return Promise.resolve();
    },
    kept: (_tx, tenantId, id) => Promise.resolve(answers.get(`${tenantId}:${id}`) ?? null),
    find: (_tx, tenantId, key) => Promise.resolve(keys.get(`${tenantId}:${key}`) ?? null),
    save(_tx, tenantId, key, stored) {
      if (keys.has(`${tenantId}:${key}`)) return Promise.resolve(false);
      keys.set(`${tenantId}:${key}`, stored);
      return Promise.resolve(true);
    },
  };
}
