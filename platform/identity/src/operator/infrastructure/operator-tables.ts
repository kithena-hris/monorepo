import { pgSchema, text, uuid } from 'drizzle-orm/pg-core';
import { instant } from '@kithena/db-kit';

/** `platform.operator` and `platform.operator_session`, per the migration. */
const platform = pgSchema('platform');

export const operator = platform.table('operator', {
  id: uuid('id').primaryKey(),
  identityId: uuid('identity_id').notNull(),
  email: text('email').notNull(),
  status: text('status').notNull(),
  createdAt: instant('created_at').notNull(),
  updatedAt: instant('updated_at').notNull(),
});

export const operatorSession = platform.table('operator_session', {
  id: uuid('id').primaryKey(),
  operatorId: uuid('operator_id').notNull(),
  startedAt: instant('started_at').notNull(),
  lastSeenAt: instant('last_seen_at').notNull(),
  expiresAt: instant('expires_at').notNull(),
  ip: text('ip'),
  userAgent: text('user_agent'),
  revokedAt: instant('revoked_at'),
});
