import { pgSchema, jsonb, text, timestamp, uuid, index } from 'drizzle-orm/pg-core';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { PendingEvent } from '@kithena/domain-kit';

/**
 * The shape drizzle infers for the outbox table. Written as a type alias
 * because the inferred type is several hundred characters wide and appears in
 * three signatures.
 */
type OutboxTable = ReturnType<typeof buildOutboxTable>;

/**
 * Transactional outbox. The write and the event land in the same transaction;
 * Debezium tails the WAL and publishes to Redpanda. No dual write, nothing
 * lost on a crash between the two.
 *
 * Each module owns its own outbox table inside its own schema.
 */
export function outboxTable(schemaName: string): OutboxTable {
  return buildOutboxTable(schemaName);
}

function buildOutboxTable(schemaName: string) {
  const schema = pgSchema(schemaName);
  return schema.table(
    'outbox',
    {
      eventId: uuid('event_id').primaryKey(),
      tenantId: uuid('tenant_id').notNull(),
      eventName: text('event_name').notNull(),
      eventVersion: text('event_version').notNull(),
      aggregateType: text('aggregate_type').notNull(),
      aggregateId: text('aggregate_id').notNull(),
      /** Partition key: guarantees per-aggregate ordering downstream. */
      partitionKey: text('partition_key').notNull(),
      envelope: jsonb('envelope').notNull(),
      createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [index('outbox_created_idx').on(t.createdAt)],
  );
}

export async function publish(
  tx: PostgresJsDatabase,
  table: ReturnType<typeof outboxTable>,
  events: readonly PendingEvent[],
): Promise<void> {
  if (events.length === 0) return;

  await tx.insert(table).values(
    events.map((e) => ({
      eventId: e.eventId,
      tenantId: e.tenantId,
      eventName: e.eventName,
      eventVersion: String(e.eventVersion),
      aggregateType: e.aggregate.type,
      aggregateId: e.aggregate.id,
      partitionKey: `${e.tenantId}:${e.aggregate.id}`,
      envelope: { ...e, recordedAt: new Date().toISOString() },
    })),
  );
}
