import { char, pgSchema, primaryKey, smallint, text, uuid } from 'drizzle-orm/pg-core';
import { calendarDate, instant, outboxTable } from '@kithena/db-kit';

/**
 * The `timeoff` schema, as Drizzle sees it. Hand-written, as People's is: the
 * migrations are the source of truth, and the integration tests read through
 * these definitions against the real migrations so the two cannot drift.
 *
 * Dates are strings (`calendarDate`), instants are strings (`instant`), and
 * day amounts are `numeric` strings: a `DayAmount` goes in and comes out with
 * the same three places.
 */

const timeoff = pgSchema('timeoff');

const createdAt = () => instant('created_at').notNull().defaultNow();
const updatedAt = () => instant('updated_at').notNull().defaultNow();

export const outbox = outboxTable('timeoff');

/* ------------------------------------------------------------- TOF-029 -- */

export const member = timeoff.table(
  'member',
  {
    tenantId: uuid('tenant_id').notNull(),
    personId: uuid('person_id').notNull(),
    displayName: text('display_name').notNull(),
    firstName: text('first_name'),
    managerPersonId: uuid('manager_person_id'),
    teamKey: text('team_key'),
    teamName: text('team_name'),
    locationKey: text('location_key'),
    country: char('country', { length: 2 }),
    region: text('region'),
    city: text('city'),
    hireDate: calendarDate('hire_date'),
    terminationDate: calendarDate('termination_date'),
    /** ISO weekdays, 1 is Monday. Null is the policy's default. */
    workPattern: smallint('work_pattern').array(),
    status: text('status').notNull().default('active'),
    /** Only moves forward, with `lastEffectiveFrom`: see the migration. */
    lastEventId: uuid('last_event_id').notNull(),
    lastEffectiveFrom: calendarDate('last_effective_from').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.personId] })],
);
