import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

/**
 * Everybody People holds at one company, as `people.person.snapshot`, and
 * every department, as `people.org_unit.updated` restating it, written
 * to People's outbox in the caller's transaction: what a module switched on
 * later needs to know everyone already there, whoever was hired before it
 * listened. One statement. A record without a name and a work address is
 * nobody a module can show yet, and is left out.
 *
 * Each row's event id is drawn in the subquery's select list, once per row.
 * `CROSS JOIN LATERAL (SELECT uuidv7())` refers to no column, so Postgres
 * draws it once for the whole statement: every row had the same id, and the
 * outbox's primary key refused the second.
 */
export async function snapshotEveryone(tx: PostgresJsDatabase, tenantId: string): Promise<number> {
  // Its departments first, each restated as it is, `fieldsChanged` empty: a
  // module names a person's department from these.
  await tx.execute(sql`
  INSERT INTO people.outbox
    (event_id, tenant_id, event_name, event_version, aggregate_type, aggregate_id,
     partition_key, envelope)
  SELECT u.event_id, u.tenant_id, 'people.org_unit.updated', '1', 'OrgUnit', u.id::text,
         u.tenant_id::text || ':' || u.id::text,
         jsonb_build_object(
           'eventId', u.event_id,
           'eventName', 'people.org_unit.updated',
           'eventVersion', 1,
           'tenantId', u.tenant_id,
           'occurredAt', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
           'recordedAt', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
           'effectiveFrom', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD'),
           'aggregate', jsonb_build_object('type', 'OrgUnit', 'id', u.id::text, 'version', 0),
           'actor', jsonb_build_object('kind', 'system', 'process', 'people.snapshot'),
           'correlationId', gen_random_uuid(),
           'causationId', NULL,
           'payload', jsonb_build_object(
             'orgUnitId', u.id,
             'name', u.name,
             'parentId', u.parent_id,
             'archived', u.archived_at IS NOT NULL,
             'fieldsChanged', '[]'::jsonb))
    FROM (SELECT uuidv7() AS event_id, o.* FROM people.org_unit o
           WHERE o.tenant_id = ${tenantId}::uuid) u`);
  const rows = await tx.execute(sql`
  INSERT INTO people.outbox
    (event_id, tenant_id, event_name, event_version, aggregate_type, aggregate_id,
     partition_key, envelope)
  SELECT p.event_id, p.tenant_id, 'people.person.snapshot', '1', 'Person', p.id::text,
         p.tenant_id::text || ':' || p.id::text,
         jsonb_build_object(
           'eventId', p.event_id,
           'eventName', 'people.person.snapshot',
           'eventVersion', 1,
           'tenantId', p.tenant_id,
           'occurredAt', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
           'recordedAt', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
           'effectiveFrom', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD'),
           'aggregate', jsonb_build_object('type', 'Person', 'id', p.id::text, 'version', 0),
           'actor', jsonb_build_object('kind', 'system', 'process', 'people.snapshot'),
           'correlationId', gen_random_uuid(),
           'causationId', NULL,
           'payload', jsonb_build_object(
             'personId', p.id,
             'identityAccountId', p.identity_account_id,
             'name', jsonb_build_object(
               'given', p.given_name, 'family', p.family_name, 'preferred', p.preferred_name),
             'workEmail', p.work_email,
             'status', CASE WHEN p.status IN ('pre_hire', 'onboarding') THEN 'pending' ELSE p.status END,
             'hireDate', to_char(p.hire_date, 'YYYY-MM-DD'),
             'lastWorkingDay', to_char(p.last_working_day, 'YYYY-MM-DD'),
             'managerId', p.manager_id,
             'orgUnitId', p.org_unit_id,
             'locationId', p.location_id,
             'legalEntityId', p.legal_entity_id,
             'title', left(NULLIF(trim(p.custom ->> 'job_title'), ''), 300)))
    FROM (SELECT uuidv7() AS event_id, r.* FROM people.person r
           WHERE r.status IN ('pre_hire', 'onboarding', 'active', 'on_leave', 'notice', 'terminated')
             AND r.given_name IS NOT NULL AND r.given_name <> ''
             AND r.family_name IS NOT NULL AND r.family_name <> ''
             AND r.work_email IS NOT NULL AND r.work_email <> ''
             AND r.tenant_id = ${tenantId}::uuid) p
  RETURNING event_id`);
  return [...rows].length;
}

/**
 * A company marked due (`people.snapshot_due`, by
 * `migrations/20261017190000_people_person_snapshot.sql`) is written once the
 * time has come, then unmarked. True when it wrote.
 */
export async function snapshotIfDue(tx: PostgresJsDatabase, tenantId: string): Promise<boolean> {
  const due = await tx.execute(sql`
    DELETE FROM people.snapshot_due
     WHERE tenant_id = ${tenantId}::uuid AND due_at <= now()
    RETURNING tenant_id`);
  if ([...due].length === 0) return false;
  await snapshotEveryone(tx, tenantId);
  return true;
}
