import { pgSchema, text, uuid } from 'drizzle-orm/pg-core';
import { instant } from '@kithena/db-kit';

/**
 * `messaging.delivery`, as defined by `migrations/20260824090000_messaging.sql`.
 *
 * Drizzle is the query builder, not the source of truth. Atlas owns the schema
 * and the migration owns the reasoning; this file exists so queries are typed.
 *
 * There is no body column to declare, and there is not going to be one — see
 * the migration for why.
 */
const messaging = pgSchema('messaging');

export const delivery = messaging.table('delivery', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  kind: text('kind').notNull(),
  toEmail: text('to_email').notNull(),
  provider: text('provider').notNull(),
  providerMessageId: text('provider_message_id'),
  status: text('status').notNull(),
  reason: text('reason'),
  createdAt: instant('created_at').notNull(),
  updatedAt: instant('updated_at').notNull(),
});
