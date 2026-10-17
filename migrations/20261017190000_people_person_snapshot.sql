-- Every person People holds, as `people.person.snapshot`, in People's outbox:
-- the facts each module's member list is made of. People's hires before the
-- relay existed never reached a module, so a module saw only their later
-- changes and named them "Someone"; every module upserts its member from this.
-- People writes the same for a company whenever its modules change
-- (`services/people/src/infrastructure/snapshot.ts`), so a module switched on
-- later learns everyone already there. Idempotent downstream by person.
DO $$
BEGIN
  IF to_regclass('people.person') IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO people.outbox
    (event_id, tenant_id, event_name, event_version, aggregate_type, aggregate_id,
     partition_key, envelope)
  SELECT e.id, p.tenant_id, 'people.person.snapshot', '1', 'Person', p.id::text,
         p.tenant_id::text || ':' || p.id::text,
         jsonb_build_object(
           'eventId', e.id,
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
             'status', CASE p.status WHEN 'pre_hire' THEN 'pending' ELSE p.status END,
             'hireDate', to_char(p.hire_date, 'YYYY-MM-DD'),
             'lastWorkingDay', to_char(p.last_working_day, 'YYYY-MM-DD'),
             'managerId', p.manager_id,
             'orgUnitId', p.org_unit_id,
             'locationId', p.location_id,
             'legalEntityId', p.legal_entity_id,
             'title', left(NULLIF(trim(p.custom ->> 'job_title'), ''), 300)))
    FROM people.person p
   CROSS JOIN LATERAL (SELECT uuidv7() AS id) e
   WHERE p.status IN ('pre_hire', 'active', 'on_leave', 'notice', 'terminated')
     AND p.given_name IS NOT NULL AND p.given_name <> ''
     AND p.family_name IS NOT NULL AND p.family_name <> ''
     AND p.work_email IS NOT NULL AND p.work_email <> '';
END $$;
