import { date, integer, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * The snapshot tables, as Drizzle sees them.
 *
 * Here rather than in `infrastructure/tables.ts` because analytics owns them
 * and nothing else reads them. Hand-written against
 * `migrations/20260923100000_people_snapshot.sql`; the integration test
 * applies that migration and reads back through these, which is what keeps
 * the two honest.
 */

const people = pgSchema('people');

export const snapshotRun = people.table('headcount_snapshot_run', {
  tenantId: uuid('tenant_id').notNull(),
  day: date('day').notNull(),
  flowsFrom: date('flows_from').notNull(),
  takenAt: timestamp('taken_at', { withTimezone: true }).notNull().defaultNow(),
});

export const snapshot = people.table('headcount_snapshot', {
  tenantId: uuid('tenant_id').notNull(),
  day: date('day').notNull(),
  scopeId: uuid('scope_id').notNull(),
  department: text('department'),
  location: text('location'),
  status: text('status').notNull(),
  employmentType: text('employment_type'),
  tenureBand: text('tenure_band').notNull(),
  completeness: text('completeness').notNull(),
  headcount: integer('headcount').notNull(),
  joiners: integer('joiners').notNull(),
  leavers: integer('leavers').notNull(),
});

export const snapshotMeasure = people.table('headcount_snapshot_measure', {
  tenantId: uuid('tenant_id').notNull(),
  day: date('day').notNull(),
  scopeId: uuid('scope_id').notNull(),
  measure: text('measure').notNull(),
  bucket: text('bucket').notNull(),
  count: integer('count').notNull(),
});
