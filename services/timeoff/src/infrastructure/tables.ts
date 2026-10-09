import {
  bigint,
  boolean,
  char,
  customType,
  integer,
  jsonb,
  numeric,
  pgSchema,
  primaryKey,
  smallint,
  text,
  uuid,
} from 'drizzle-orm/pg-core';
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
    workEmail: text('work_email'),
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
    timeZone: text('time_zone').notNull().default('UTC'),
    /** The account the member signs in with (TOF-050a); not unique, see the migration. */
    accountId: uuid('account_id'),
    /** Only moves forward, with `lastEffectiveFrom`: see the migration. */
    lastEventId: uuid('last_event_id').notNull(),
    lastEffectiveFrom: calendarDate('last_effective_from').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.personId] })],
);

/* ------------------------------------------------------------- TOF-030 -- */

/** Days or hours, `numeric(9,3)`. */
const amount = (name: string) => numeric(name, { precision: 9, scale: 3 });

export const leaveType = timeoff.table(
  'leave_type',
  {
    tenantId: uuid('tenant_id').notNull(),
    key: text('key').notNull(),
    name: jsonb('name').notNull(),
    category: text('category').notNull(),
    colorToken: text('color_token').notNull(),
    icon: text('icon').notNull(),
    unit: text('unit').notNull().default('day'),
    tracked: boolean('tracked').notNull(),
    paid: text('paid').notNull(),
    approvalRuleKey: text('approval_rule_key'),
    visibility: text('visibility').notNull(),
    requiresNoteAfterDays: integer('requires_note_after_days'),
    appliesTo: jsonb('applies_to'),
    statutory: boolean('statutory').notNull().default(false),
    hiddenAt: instant('hidden_at'),
    deletedAt: instant('deleted_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.key] })],
);

export const policy = timeoff.table(
  'policy',
  {
    tenantId: uuid('tenant_id').notNull(),
    id: uuid('id').notNull(),
    leaveTypeKey: text('leave_type_key').notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] })],
);

export const policyVersion = timeoff.table(
  'policy_version',
  {
    tenantId: uuid('tenant_id').notNull(),
    policyId: uuid('policy_id').notNull(),
    version: integer('version').notNull(),
    status: text('status').notNull().default('draft'),
    /** `PolicyDefinition`, whole. */
    definition: jsonb('definition').notNull(),
    effectiveFrom: calendarDate('effective_from'),
    publishedAt: instant('published_at'),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.policyId, t.version] })],
);

/** Insert-only: `svc_timeoff` holds no UPDATE or DELETE on it. */
export const ledgerEntry = timeoff.table(
  'ledger_entry',
  {
    tenantId: uuid('tenant_id').notNull(),
    id: uuid('id').notNull(),
    personId: uuid('person_id').notNull(),
    leaveTypeKey: text('leave_type_key').notNull(),
    kind: text('kind').notNull(),
    amount: amount('amount').notNull(),
    unit: text('unit').notNull(),
    effectiveOn: calendarDate('effective_on').notNull(),
    occurredAt: instant('occurred_at').notNull(),
    policyVersion: integer('policy_version'),
    supersedes: uuid('supersedes'),
    requestId: uuid('request_id'),
    reason: text('reason'),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] })],
);

/* ------------------------------------------------------------- TOF-031 -- */

/** `{[2026-10-19,2026-10-21),[2026-10-22,2026-10-24)}`, as Postgres prints it. */
const datemultirange = customType<{ data: string }>({ dataType: () => 'datemultirange' });

export const request = timeoff.table(
  'request',
  {
    tenantId: uuid('tenant_id').notNull(),
    id: uuid('id').notNull(),
    personId: uuid('person_id').notNull(),
    leaveTypeKey: text('leave_type_key').notNull(),
    status: text('status').notNull().default('pending'),
    /** No two live requests of one member share a day: an exclusion constraint. */
    days: datemultirange('days').notNull(),
    startsHalfDay: boolean('starts_half_day').notNull().default(false),
    endsHalfDay: boolean('ends_half_day').notNull().default(false),
    workingDays: amount('working_days').notNull(),
    belowZero: boolean('below_zero').notNull().default(false),
    note: text('note'),
    /** Special-category health data: a file reference, never the content. */
    sickNoteFileId: uuid('sick_note_file_id'),
    proposals: jsonb('proposals').notNull().default([]),
    pendingChange: jsonb('pending_change'),
    datesEventId: uuid('dates_event_id'),
    version: integer('version').notNull().default(0),
    requestedAt: instant('requested_at').notNull(),
    approvalChain: text('approval_chain').array().notNull().default([]),
    approvalStep: integer('approval_step').notNull().default(0),
    waitingSince: calendarDate('waiting_since'),
    /** A person's id, or `hr`. */
    escalatedTo: text('escalated_to'),
    proposedBy: text('proposed_by'),
    proposalMessage: text('proposal_message'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] })],
);

export const requestDecision = timeoff.table(
  'request_decision',
  {
    tenantId: uuid('tenant_id').notNull(),
    id: uuid('id').notNull(),
    requestId: uuid('request_id').notNull(),
    outcome: text('outcome').notNull(),
    role: text('role').notNull(),
    decidedBy: uuid('decided_by').notNull(),
    onBehalfOf: uuid('on_behalf_of'),
    reason: text('reason'),
    decidedAt: instant('decided_at').notNull(),
    eventId: uuid('event_id'),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] })],
);

/* ------------------------------------------------------------- TOF-032 -- */

/** `[2026-12-21,2027-01-01)`, as Postgres prints it. */
const daterange = customType<{ data: string }>({ dataType: () => 'daterange' });

export const approvalRule = timeoff.table(
  'approval_rule',
  {
    tenantId: uuid('tenant_id').notNull(),
    key: text('key').notNull(),
    subject: text('subject').notNull(),
    leaveTypes: text('leave_types').array(),
    appliesWhen: text('applies_when').notNull().default('always'),
    approvers: text('approvers').array().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.key] })],
);

export const delegation = timeoff.table(
  'delegation',
  {
    tenantId: uuid('tenant_id').notNull(),
    approverPersonId: uuid('approver_person_id').notNull(),
    delegatePersonId: uuid('delegate_person_id').notNull(),
    during: daterange('during'),
    automatic: boolean('automatic').notNull().default(false),
    salaryRelated: boolean('salary_related').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.approverPersonId] })],
);

export const teamMinimum = timeoff.table(
  'team_minimum',
  {
    tenantId: uuid('tenant_id').notNull(),
    teamKey: text('team_key').notNull(),
    atLeast: integer('at_least').notNull(),
    unit: text('unit').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.teamKey] })],
);

export const holidayCalendar = timeoff.table(
  'holiday_calendar',
  {
    tenantId: uuid('tenant_id').notNull(),
    key: text('key').notNull(),
    name: text('name').notNull(),
    level: text('level').notNull(),
    weekendRule: text('weekend_rule').notNull().default('none'),
    country: char('country', { length: 2 }),
    region: text('region'),
    city: text('city'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.key] })],
);

export const holiday = timeoff.table(
  'holiday',
  {
    tenantId: uuid('tenant_id').notNull(),
    calendarKey: text('calendar_key').notNull(),
    day: calendarDate('day').notNull(),
    name: text('name').notNull(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.calendarKey, t.day] })],
);

/* ------------------------------------------------------------- TOF-033 -- */

/** A SHA-256: `bytea` in the database, hex here. */
const sha256 = customType<{ data: string; driverData: Buffer }>({
  dataType: () => 'bytea',
  toDriver: (hex: string) => Buffer.from(hex, 'hex'),
  fromDriver: (value: Buffer) => value.toString('hex'),
});

export const kioskDevice = timeoff.table(
  'kiosk_device',
  {
    tenantId: uuid('tenant_id').notNull(),
    id: uuid('id').notNull(),
    locationKey: text('location_key').notNull(),
    name: text('name').notNull(),
    /** The token's SHA-256, never the token. */
    tokenHash: sha256('token_hash').notNull(),
    lastSeenAt: instant('last_seen_at'),
    revokedAt: instant('revoked_at'),
    lastSequence: bigint('last_sequence', { mode: 'number' }).notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] })],
);

/** A member's badge or PIN, as an HMAC (TOF-107). */
export const kioskCredential = timeoff.table(
  'kiosk_credential',
  {
    tenantId: uuid('tenant_id').notNull(),
    personId: uuid('person_id').notNull(),
    kind: text('kind').notNull(),
    hash: sha256('hash').notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.personId, t.kind] })],
);

/** Insert-only, and no coordinate column: the integration test holds the list. */
export const punch = timeoff.table(
  'punch',
  {
    tenantId: uuid('tenant_id').notNull(),
    id: uuid('id').notNull(),
    personId: uuid('person_id').notNull(),
    at: instant('at').notNull(),
    recordedAt: instant('recorded_at').notNull(),
    kind: text('kind').notNull(),
    source: text('source').notNull(),
    workModel: text('work_model').notNull(),
    deviceId: uuid('device_id'),
    insideOfficeArea: boolean('inside_office_area'),
    supersedes: uuid('supersedes'),
    reason: text('reason'),
    clockSkewSeconds: integer('clock_skew_seconds'),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] })],
);

export const schedule = timeoff.table(
  'schedule',
  {
    tenantId: uuid('tenant_id').notNull(),
    key: text('key').notNull(),
    name: text('name').notNull(),
    kind: text('kind').notNull(),
    /** The domain's `Schedule`, whole. */
    definition: jsonb('definition').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.key] })],
);

export const memberSchedule = timeoff.table(
  'member_schedule',
  {
    tenantId: uuid('tenant_id').notNull(),
    personId: uuid('person_id').notNull(),
    effectiveFrom: calendarDate('effective_from').notNull(),
    scheduleKey: text('schedule_key').notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.personId, t.effectiveFrom] })],
);

export const payPeriod = timeoff.table(
  'pay_period',
  {
    tenantId: uuid('tenant_id').notNull(),
    id: uuid('id').notNull(),
    startsOn: calendarDate('starts_on').notNull(),
    endsOn: calendarDate('ends_on').notNull(),
    closedAt: instant('closed_at'),
    closedBy: uuid('closed_by'),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] })],
);

/** Insert-only; nothing posts into a closed period (a trigger). */
export const payPeriodLine = timeoff.table(
  'pay_period_line',
  {
    tenantId: uuid('tenant_id').notNull(),
    id: uuid('id').notNull(),
    periodId: uuid('period_id').notNull(),
    personId: uuid('person_id').notNull(),
    teamKey: text('team_key').notNull(),
    day: calendarDate('day').notNull(),
    workedMinutes: integer('worked_minutes').notNull(),
    compMinutes: integer('comp_minutes').notNull().default(0),
    paidMinutes: integer('paid_minutes').notNull().default(0),
    supersedes: uuid('supersedes'),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] })],
);

/* ------------------------------------------------------------- TOF-034 -- */

/** The layers a location observes, most general first. */
export const locationHolidayCalendar = timeoff.table(
  'location_holiday_calendar',
  {
    tenantId: uuid('tenant_id').notNull(),
    locationKey: text('location_key').notNull(),
    calendarKey: text('calendar_key').notNull(),
    position: smallint('position').notNull(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.locationKey, t.calendarKey] })],
);

/** `auto_approval` and `attendance_rules`, one document each; absent is the default. */
export const setting = timeoff.table(
  'setting',
  {
    tenantId: uuid('tenant_id').notNull(),
    key: text('key').notNull(),
    value: jsonb('value').notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.key] })],
);

/** A balance changed by hand, and who asked and decided (`balance_adjustment`). */
export const balanceAdjustment = timeoff.table(
  'balance_adjustment',
  {
    tenantId: uuid('tenant_id').notNull(),
    id: uuid('id').notNull(),
    personId: uuid('person_id').notNull(),
    leaveTypeKey: text('leave_type_key').notNull(),
    amount: amount('amount').notNull(),
    effectiveOn: calendarDate('effective_on').notNull(),
    reason: text('reason').notNull(),
    proposedBy: text('proposed_by').notNull(),
    proposedAt: instant('proposed_at').notNull(),
    status: text('status').notNull(),
    decidedBy: text('decided_by'),
    decidedAt: instant('decided_at'),
    note: text('note'),
    entryId: uuid('entry_id'),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] })],
);

export const overtimeDecision = timeoff.table(
  'overtime_decision',
  {
    tenantId: uuid('tenant_id').notNull(),
    personId: uuid('person_id').notNull(),
    day: calendarDate('day').notNull(),
    minutes: integer('minutes').notNull(),
    outcome: text('outcome').notNull(),
    decidedBy: text('decided_by').notNull(),
    decidedAt: instant('decided_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.personId, t.day] })],
);

export const feedVersion = timeoff.table(
  'feed_version',
  {
    tenantId: uuid('tenant_id').notNull(),
    personId: uuid('person_id').notNull(),
    version: integer('version').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.personId] })],
);

/** People's work locations, as its events describe them (TOF-045). */
export const location = timeoff.table(
  'location',
  {
    tenantId: uuid('tenant_id').notNull(),
    locationKey: text('location_key').notNull(),
    name: text('name').notNull(),
    country: char('country', { length: 2 }),
    timeZone: text('time_zone').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.locationKey] })],
);

/* ------------------------------------------------------------- TOF-102 -- */

export const parentalPlan = timeoff.table(
  'parental_plan',
  {
    tenantId: uuid('tenant_id').notNull(),
    id: uuid('id').notNull(),
    personId: uuid('person_id').notNull(),
    status: text('status').notNull().default('draft'),
    country: char('country', { length: 2 }).notNull(),
    role: text('role').notNull(),
    childDate: calendarDate('child_date').notNull(),
    /** Special-category health data: it says a pregnancy exists. */
    dueDate: calendarDate('due_date'),
    birthDate: calendarDate('birth_date'),
    singleParent: boolean('single_parent').notNull().default(false),
    children: smallint('children').notNull().default(1),
    company: jsonb('company'),
    teamSees: text('team_sees').notNull().default('type'),
    handover: jsonb('handover').notNull().default([]),
    version: integer('version').notNull().default(0),
    sentAt: instant('sent_at'),
    approvedAt: instant('approved_at'),
    approvedBy: uuid('approved_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] })],
);

export const parentalBlock = timeoff.table(
  'parental_block',
  {
    tenantId: uuid('tenant_id').notNull(),
    planId: uuid('plan_id').notNull(),
    position: smallint('position').notNull(),
    kind: text('kind').notNull(),
    leaveTypeKey: text('leave_type_key').notNull(),
    fromOn: calendarDate('from_on').notNull(),
    toOn: calendarDate('to_on').notNull(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.planId, t.position] })],
);

/** Readable without a tenant: the list background jobs run over. */
export const tenant = timeoff.table('tenant', {
  tenantId: uuid('tenant_id').primaryKey(),
  firstSeenAt: instant('first_seen_at').notNull().defaultNow(),
});

/* ------------------------------------------------------------- TOF-109 -- */

/** A company's connection to a calendar or chat provider; `secret` sealed by its adapter. */
export const integration = timeoff.table(
  'integration',
  {
    tenantId: uuid('tenant_id').notNull(),
    provider: text('provider').notNull(),
    config: jsonb('config').notNull(),
    secret: text('secret'),
    connectedAt: instant('connected_at').notNull(),
    connectedBy: uuid('connected_by').notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.provider] })],
);

/** A member's own sealed grant for a provider. */
export const integrationMember = timeoff.table(
  'integration_member',
  {
    tenantId: uuid('tenant_id').notNull(),
    provider: text('provider').notNull(),
    personId: uuid('person_id').notNull(),
    secret: text('secret').notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.provider, t.personId] })],
);

/* ------------------------------------------------------------- TOF-114 -- */

export const scimConnection = timeoff.table(
  'scim_connection',
  {
    tenantId: uuid('tenant_id').notNull(),
    id: uuid('id').notNull(),
    tokenHash: sha256('token_hash').notNull(),
    createdBy: uuid('created_by').notNull(),
    createdAt: createdAt(),
    revokedAt: instant('revoked_at'),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] })],
);

export const scimUser = timeoff.table(
  'scim_user',
  {
    tenantId: uuid('tenant_id').notNull(),
    personId: uuid('person_id').notNull(),
    userName: text('user_name').notNull(),
    externalId: text('external_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.personId] })],
);
