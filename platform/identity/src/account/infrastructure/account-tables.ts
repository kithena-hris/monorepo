import {
  date,
  index,
  integer,
  pgSchema,
  smallint,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { instant } from '@kithena/db-kit';

/**
 * `platform.identity`, `credential`, `account` and `session`, as defined by
 * `migrations/20260821230000_identity.sql`.
 *
 * Drizzle is the query builder, not the source of truth. Atlas owns the schema
 * and the migration owns the reasoning; this file exists so queries are typed.
 */
const platform = pgSchema('platform');

export const identity = platform.table('identity', {
  id: uuid('id').primaryKey(),
  createdAt: instant('created_at').notNull(),
});

export const account = platform.table(
  'account',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    identityId: uuid('identity_id').notNull(),
    status: text('status').notNull(),
    workEmail: text('work_email').notNull(),
    timeZone: text('time_zone').notNull(),
    employmentStart: date('employment_start', { mode: 'string' }).notNull(),
    sessionLimit: smallint('session_limit').notNull(),
    version: integer('version').notNull(),
    createdAt: instant('created_at').notNull(),
    updatedAt: instant('updated_at').notNull(),
  },
  (t) => [index('account_identity_idx').on(t.identityId)],
);

export const session = platform.table(
  'session',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    accountId: uuid('account_id').notNull(),
    slot: smallint('slot').notNull(),
    startedAt: instant('started_at').notNull(),
    lastSeenAt: instant('last_seen_at').notNull(),
    expiresAt: instant('expires_at').notNull(),
    amr: text('amr').array().notNull(),
    ip: text('ip'),
    userAgent: text('user_agent'),
    aaguid: text('aaguid'),
  },
  // Declared here as well as in the migration so a query that would collide
  // reads as a collision rather than as a mystery from the driver.
  (t) => [uniqueIndex('session_slot_key').on(t.accountId, t.slot)],
);
