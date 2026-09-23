import { bigint, integer, jsonb, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { encrypted } from '@kithena/db-kit';

/** `migrations/20260923120000_people_webhooks.sql`, as Drizzle sees it. */

const people = pgSchema('people');

export const webhookEndpoint = people.table('webhook_endpoint', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  url: text('url').notNull(),
  events: text('events').array().notNull(),
  allowlist: text('allowlist').array().notNull(),
  secretCiphertext: encrypted('secret_ciphertext').notNull(),
  secretKeyId: text('secret_key_id').notNull(),
  previousSecretCiphertext: encrypted('previous_secret_ciphertext'),
  previousSecretKeyId: text('previous_secret_key_id'),
  previousSecretExpiresAt: timestamp('previous_secret_expires_at', { withTimezone: true }),
  disabledAt: timestamp('disabled_at', { withTimezone: true }),
  disabledReason: text('disabled_reason'),
  /** `20260924120100`: who is emailed when the endpoint is disabled. */
  alertEmail: text('alert_email'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const webhookDelivery = people.table('webhook_delivery', {
  id: uuid('id').primaryKey().defaultRandom(),
  seq: bigint('seq', { mode: 'number' }).generatedAlwaysAsIdentity(),
  tenantId: uuid('tenant_id').notNull(),
  endpointId: uuid('endpoint_id').notNull(),
  eventId: uuid('event_id').notNull(),
  eventName: text('event_name').notNull(),
  aggregateId: text('aggregate_id').notNull(),
  envelope: jsonb('envelope').notNull(),
  status: text('status').notNull(),
  attempts: integer('attempts').notNull(),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull(),
  firstAttemptedAt: timestamp('first_attempted_at', { withTimezone: true }),
  lastResponse: integer('last_response'),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  replayOf: uuid('replay_of'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
