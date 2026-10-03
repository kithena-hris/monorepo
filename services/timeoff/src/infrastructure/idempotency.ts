import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { char, jsonb, pgSchema, primaryKey, smallint, text, uuid } from 'drizzle-orm/pg-core';
import { instant } from '@kithena/db-kit';

import type { IdempotencyStore } from '../application/ports.js';

/**
 * `timeoff.idempotency_key` (TOF-046), bound to one tenant transaction, for
 * the unit of work to hand out as `Tx.idempotency`. Its own file rather than
 * `tables.ts` because nothing but this store reads it.
 */

export const idempotencyKey = pgSchema('timeoff').table(
  'idempotency_key',
  {
    tenantId: uuid('tenant_id').notNull(),
    key: text('key').notNull(),
    requestHash: char('request_hash', { length: 64 }).notNull(),
    status: smallint('status').notNull(),
    answer: jsonb('answer').notNull(),
    createdAt: instant('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.key] })],
);

export function drizzleIdempotency(tx: PostgresJsDatabase, tenantId: string): IdempotencyStore {
  return {
    async find(key) {
      const rows = await tx
        .select({
          requestHash: idempotencyKey.requestHash,
          status: idempotencyKey.status,
          answer: idempotencyKey.answer,
        })
        .from(idempotencyKey)
        .where(and(eq(idempotencyKey.tenantId, tenantId), eq(idempotencyKey.key, key)))
        .limit(1);
      return rows[0] ?? null;
    },

    async save(key, stored) {
      // ON CONFLICT DO NOTHING rather than catching 23505: a unique violation
      // aborts the transaction, which the caller rolls back deliberately.
      const inserted = await tx
        .insert(idempotencyKey)
        .values({
          tenantId,
          key,
          requestHash: stored.requestHash,
          status: stored.status,
          answer: stored.answer,
        })
        .onConflictDoNothing()
        .returning({ key: idempotencyKey.key });
      return inserted.length === 1;
    },
  };
}
