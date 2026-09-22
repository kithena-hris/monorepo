import {
  boolean,
  char,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { outboxTable } from '@kithena/db-kit';

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
  },
  (t) => [uniqueIndex('schema_version_pk_idx').on(t.tenantId, t.version)],
);

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
    ciphertext: text('ciphertext').notNull(),
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
    normalisedValue: text('normalised_value').notNull(),
    personId: uuid('person_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('attribute_unique_pk_idx').on(
      t.tenantId,
      t.attributeKey,
      t.scopeId,
      t.normalisedValue,
    ),
    index('attribute_unique_person_lookup').on(t.tenantId, t.personId),
  ],
);
