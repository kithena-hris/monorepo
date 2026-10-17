-- Performance's activity moves to the company's one log (`docs/audit.md`):
-- every line `performance.audit` already holds becomes the
-- `performance.activity.recorded` event Performance now raises for each new
-- act, in Performance's outbox. The relay publishes new outbox rows, and these
-- are new rows, so the older lines reach the log by the road every other
-- event takes. People's backfill (`20260929160100_people_settings_activity_event.sql`)
-- is the model.
--
-- The event's id is the line's when it is a UUIDv7, so a line is never two
-- entries. What a line was done to is kept as its label; its kind was never
-- recorded, so no subject id travels without one. `performance.audit` is no
-- longer written, and goes in a later contract migration.
DO $$
BEGIN
  IF to_regclass('performance.audit') IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO performance.outbox
    (event_id, tenant_id, event_name, event_version, aggregate_type, aggregate_id,
     partition_key, envelope)
  SELECT e.event_id, a.tenant_id, 'performance.activity.recorded', '1',
         'activity', a.id::text, a.tenant_id::text || ':' || a.id::text,
         jsonb_build_object(
           'eventId', e.event_id,
           'eventName', 'performance.activity.recorded',
           'eventVersion', 1,
           'tenantId', a.tenant_id,
           'occurredAt', to_char(a.at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
           'recordedAt', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
           'effectiveFrom', to_char(a.at AT TIME ZONE 'UTC', 'YYYY-MM-DD'),
           'aggregate', jsonb_build_object('type', 'activity', 'id', a.id::text, 'version', 0),
           'actor', CASE
             WHEN a.actor_account_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
               THEN jsonb_build_object('kind', 'user', 'userId', a.actor_account_id)
             ELSE jsonb_build_object('kind', 'system', 'process', 'performance')
           END,
           'correlationId', gen_random_uuid(),
           'causationId', NULL,
           'payload', jsonb_build_object(
             'area', CASE
               WHEN a.action ~ '^(Read |Tried to read|Downloaded|Exported)' THEN 'access'
               WHEN a.action LIKE 'Used AI%' THEN 'ai'
               WHEN a.action LIKE '%connected tool%' THEN 'integrations'
               WHEN a.action = 'Changed settings' THEN 'settings'
               ELSE 'records'
             END,
             'action', left(a.action, 200),
             'detail', CASE
               WHEN jsonb_array_length(a.fields) = 0 THEN NULL
               ELSE left(
                 CASE WHEN a.outcome = 'refused' THEN 'Why: ' ELSE 'Fields: ' END
                   || (SELECT string_agg(f, ', ') FROM jsonb_array_elements_text(a.fields) f) || '.',
                 500)
             END,
             'subjectKind', NULL,
             'subjectId', NULL,
             'subjectLabel', left(a.target, 300),
             'reason', NULL,
             'outcome', a.outcome,
             'via', CASE WHEN a.actor_account_id = 'system' THEN 'Kithena' ELSE left(a.via, 40) END,
             'ai', a.ai))
    FROM performance.audit a
   CROSS JOIN LATERAL (
     SELECT CASE WHEN uuid_extract_version(a.id) = 7 THEN a.id ELSE uuidv7() END AS event_id
   ) e
  ON CONFLICT (event_id) DO NOTHING;
END $$;
