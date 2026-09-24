import {
  bigint,
  boolean,
  char,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgSchema,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { encrypted, outboxTable } from '@kithena/db-kit';

/**
 * The `people` schema, as Drizzle sees it.
 *
 * Hand-written rather than introspected, because the migrations are the source
 * of truth and an introspected copy would drift the first time somebody ran
 * the generator against a database that was one migration behind. The
 * integration tests are what keep the two honest: they apply the real
 * migrations and then read through these definitions, so a column renamed in
 * one place and not the other fails at `pnpm test:integration` rather than in
 * production.
 */

const people = pgSchema('people');

export const outbox = outboxTable('people');

export const section = people.table(
  'section',
  {
    tenantId: uuid('tenant_id').notNull(),
    key: text('key').notNull(),
    labels: jsonb('labels').notNull(),
    ord: integer('ord').notNull().default(0),
    visibility: text('visibility').array().notNull(),
    origin: text('origin').notNull(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('section_pk_idx').on(t.tenantId, t.key)],
);

export const attributeDefinition = people.table(
  'attribute_definition',
  {
    tenantId: uuid('tenant_id').notNull(),
    key: text('key').notNull(),
    sectionKey: text('section_key').notNull(),
    labels: jsonb('labels').notNull(),
    description: jsonb('description'),
    ord: integer('ord').notNull().default(0),
    dataType: text('data_type').notNull(),
    typeConfig: jsonb('type_config').notNull(),
    cardinality: text('cardinality').notNull().default('single'),
    requiredness: jsonb('requiredness').notNull(),
    ownership: text('ownership').array().notNull(),
    visibility: text('visibility').array().notNull(),
    collectAt: text('collect_at').notNull(),
    classification: jsonb('classification').notNull(),
    classificationSource: text('classification_source').notNull(),
    effectiveDated: boolean('effective_dated').notNull().default(false),
    uniqueScope: text('unique_scope').notNull().default('none'),
    encrypted: boolean('encrypted').notNull().default(false),
    indexed: boolean('indexed').notNull().default(false),
    includeInDirectory: boolean('include_in_directory').notNull().default(false),
    includeInEvents: boolean('include_in_events').notNull().default(false),
    origin: text('origin').notNull(),
    deprecatedAt: timestamp('deprecated_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('attribute_definition_pk_idx').on(t.tenantId, t.key),
    index('attribute_definition_section_idx').on(t.tenantId, t.sectionKey, t.ord),
  ],
);

export const schemaVersion = people.table(
  'schema_version',
  {
    tenantId: uuid('tenant_id').notNull(),
    version: integer('version').notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull().defaultNow(),
    publishedBy: uuid('published_by'),
    checksum: char('checksum', { length: 64 }).notNull(),
    document: jsonb('document').notNull(),
    rolledBackFrom: integer('rolled_back_from'),
    /** The tenant-local date the publish's preview evaluated `requiredFrom` on. */
    evaluatedOn: date('evaluated_on'),
  },
  (t) => [uniqueIndex('schema_version_pk_idx').on(t.tenantId, t.version)],
);

/**
 * The same table with `evaluated_at` (20260924170000). Separate so that every
 * read and write that does not need the instant keeps working against a
 * database one migration behind; only the publish writes it and only the
 * recompute reads it.
 */
export const schemaVersionEvaluated = people.table('schema_version', {
  tenantId: uuid('tenant_id').notNull(),
  version: integer('version').notNull(),
  publishedAt: timestamp('published_at', { withTimezone: true }).notNull().defaultNow(),
  publishedBy: uuid('published_by'),
  checksum: char('checksum', { length: 64 }).notNull(),
  document: jsonb('document').notNull(),
  rolledBackFrom: integer('rolled_back_from'),
  evaluatedOn: date('evaluated_on'),
  /** The instant the preview read every person's own day off (PEO-099). */
  evaluatedAt: timestamp('evaluated_at', { withTimezone: true }),
});

export const person = people.table('person', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  identityAccountId: uuid('identity_account_id'),
  status: text('status').notNull().default('provisional'),

  employeeNumber: text('employee_number'),
  legalEntityId: uuid('legal_entity_id'),
  givenName: text('given_name'),
  familyName: text('family_name'),
  preferredName: text('preferred_name'),
  workEmail: text('work_email'),

  hireDate: date('hire_date'),
  seniorityDate: date('seniority_date'),
  lastWorkingDay: date('last_working_day'),
  /** When access ended with this employment (PEO-109, 20260924220000). */
  accessEndedAt: timestamp('access_ended_at', { withTimezone: true }),

  managerId: uuid('manager_id'),
  orgUnitId: uuid('org_unit_id'),
  locationId: uuid('location_id'),

  employmentType: text('employment_type'),
  workModel: text('work_model'),
  fte: numeric('fte', { precision: 5, scale: 4 }),

  /*
   * `numeric` read as a string, which is Drizzle's default and is the right
   * one here. A `numeric(19,4)` parsed into a JavaScript number is a salary
   * that has quietly become a float, which is the rule this repository has
   * held since its first commit.
   */
  baseSalary: numeric('base_salary', { precision: 19, scale: 4 }),
  salaryCurrency: char('salary_currency', { length: 3 }),

  custom: jsonb('custom').notNull().default({}),
  schemaVersion: integer('schema_version'),
  completeness: text('completeness').notNull().default('not_applicable'),
  sourceOfRecord: text('source_of_record').notNull().default('own'),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const personAttributeHistory = people.table(
  'person_attribute_history',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    personId: uuid('person_id').notNull(),
    attributeKey: text('attribute_key').notNull(),
    value: jsonb('value'),
    effectiveFrom: date('effective_from').notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
    actor: jsonb('actor').notNull(),
    supersedes: uuid('supersedes'),
    eventId: uuid('event_id'),
  },
  (t) => [index('history_read_idx').on(t.tenantId, t.personId, t.attributeKey, t.effectiveFrom)],
);

export const personSecret = people.table(
  'person_secret',
  {
    tenantId: uuid('tenant_id').notNull(),
    personId: uuid('person_id').notNull(),
    attributeKey: text('attribute_key').notNull(),
    // `bytea` in the database, base64 here. The migration says bytea and this
    // said text, which is the kind of disagreement that only surfaces as a
    // driver error on the first real write.
    ciphertext: encrypted('ciphertext').notNull(),
    keyId: text('key_id').notNull(),
    last4: text('last4'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('person_secret_pk_idx').on(t.tenantId, t.personId, t.attributeKey)],
);

export const attributeUnique = people.table(
  'attribute_unique',
  {
    tenantId: uuid('tenant_id').notNull(),
    attributeKey: text('attribute_key').notNull(),
    scopeId: uuid('scope_id').notNull(),
    /**
     * Pre-PEO-082 claims only, until the rotation job backfills them; never
     * written now. Dropped by a later migration (20260924150000 says when).
     */
    normalisedValue: text('normalised_value'),
    /** HMAC-SHA-256 of the normalised value under the tenant's claim key. `bytea`, base64 here. */
    valueHash: encrypted('value_hash'),
    /** The master key the claim key was derived from. Null with `valueHash`. */
    keyId: text('key_id'),
    /** Who holds this value under the current key, when the rotation could not re-key it. */
    conflictWith: uuid('conflict_with'),
    personId: uuid('person_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // The value leads, so for a tenant the statistics have not seen no other
    // lookup can take this index for a scan of the tenant (20260924350000).
    uniqueIndex('attribute_unique_value_key').on(t.valueHash, t.tenantId, t.attributeKey, t.scopeId),
  ],
);

/* Legal entities, locations and settings: `20260924170000_people_calendar.sql`. */

export const tenantSettings = people.table('tenant_settings', {
  tenantId: uuid('tenant_id').primaryKey(),
  defaultTimeZone: text('default_time_zone').notNull(),
  cohortMinimum: integer('cohort_minimum').notNull(),
  /* 20260924170100: the company, as the back office last described it. */
  slug: text('slug'),
  displayName: text('display_name'),
  companyAsOf: timestamp('company_as_of', { withTimezone: true }),
  /* 20260924270100: the modules the company bought, from the back office (PEO-114). */
  entitlements: text('entitlements').array(),
  entitlementsAsOf: timestamp('entitlements_as_of', { withTimezone: true }),
});

export const legalEntity = people.table('legal_entity', {
  tenantId: uuid('tenant_id').notNull(),
  id: uuid('id').notNull(),
  name: text('name').notNull(),
  country: char('country', { length: 2 }).notNull(),
  timeZone: text('time_zone').notNull(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
});

/* 20260924220200: one row per employment on a person (PEO-110). */
export const employmentPeriod = people.table(
  'employment_period',
  {
    tenantId: uuid('tenant_id').notNull(),
    personId: uuid('person_id').notNull(),
    period: smallint('period').notNull(),
    legalEntityId: uuid('legal_entity_id'),
    startedOn: date('started_on').notNull(),
    lastWorkingDay: date('last_working_day'),
    leavingReason: text('leaving_reason'),
    eligibleForRehire: boolean('eligible_for_rehire'),
    noticeFrom: text('notice_from'),
    rehireOverrideReason: text('rehire_override_reason'),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.personId, t.period] })],
);

/* 20260924200000: one numbering scheme per legal entity (PEO-101). */
export const employeeNumbering = people.table('employee_numbering', {
  tenantId: uuid('tenant_id').notNull(),
  legalEntityId: uuid('legal_entity_id').notNull(),
  prefix: text('prefix').notNull(),
  digits: smallint('digits').notNull(),
  nextValue: bigint('next_value', { mode: 'number' }).notNull(),
});

export const location = people.table('location', {
  tenantId: uuid('tenant_id').notNull(),
  id: uuid('id').notNull(),
  legalEntityId: uuid('legal_entity_id').notNull(),
  name: text('name').notNull(),
  country: char('country', { length: 2 }).notNull(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
});

export const locationZone = people.table('location_zone', {
  tenantId: uuid('tenant_id').notNull(),
  id: uuid('id').notNull(),
  locationId: uuid('location_id').notNull(),
  effectiveFrom: date('effective_from').notNull(),
  timeZone: text('time_zone').notNull(),
  supersedes: uuid('supersedes'),
});

/** Every tenant People has work for. Readable unscoped, by design: see the migration. */
export const tenant = people.table('tenant', {
  tenantId: uuid('tenant_id').primaryKey(),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
});
