-- The central activity log's backfill (`docs/audit.md`): every Settings
-- activity entry already recorded becomes the `people.settings.activity_recorded`
-- event People now raises for each new one, in People's outbox. The relay
-- publishes new outbox rows, and these are new rows, so the older entries reach
-- the log by the road every other event takes.
--
-- The event's id is the entry's, the live path's rule, so an entry is never two
-- lines of the log. An entry whose id
-- is not a UUIDv7 (the envelope requires one, for ordering) gets a fresh v7
-- instead; People has only ever written v7s, so this is for hand-made rows.
--
-- A few entries name a section or field by its key, as the router worded them
-- before it said labels (`subjectKey`, `services/people/src/http/activity.ts`):
-- those take the label the key has now in the draft, and keep the key where
-- nothing answers to it any more.
--
-- The envelope is built here exactly as `activityRecorded` in
-- `services/people/src/infrastructure/drizzle-activity.ts` builds it, and an
-- integration test parses what this writes against the contract. Where the
-- database has no People (identity's own test harness) the table is empty or
-- absent, and nothing is written.
DO $$
BEGIN
  IF to_regclass('people.settings_activity') IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO people.outbox
    (event_id, tenant_id, event_name, event_version, aggregate_type, aggregate_id,
     partition_key, envelope)
  SELECT e.event_id, a.tenant_id, 'people.settings.activity_recorded', '1',
         'SettingsActivity', a.id::text, a.tenant_id::text || ':' || a.id::text,
         jsonb_build_object(
           'eventId', e.event_id,
           'eventName', 'people.settings.activity_recorded',
           'eventVersion', 1,
           'tenantId', a.tenant_id,
           'occurredAt', to_char(a.at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
           'recordedAt', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
           'effectiveFrom', NULL,
           'aggregate', jsonb_build_object('type', 'SettingsActivity', 'id', a.id::text, 'version', 1),
           'actor', jsonb_strip_nulls(jsonb_build_object(
             'kind', 'user', 'userId', a.actor, 'onBehalfOf', a.on_behalf_of)),
           'correlationId', gen_random_uuid(),
           'causationId', NULL,
           'payload', jsonb_build_object(
             'area', a.area,
             'action', a.action,
             'subject', w.subject,
             'detail', a.detail,
             'reason', a.reason))
    FROM people.settings_activity a
   CROSS JOIN LATERAL (
     SELECT CASE WHEN uuid_extract_version(a.id) = 7 THEN a.id ELSE uuidv7() END AS event_id
   ) e
   CROSS JOIN LATERAL (
     SELECT CASE
              WHEN a.action = 'Reordered the fields in a section' THEN coalesce(
                (SELECT s.labels ->> 'default' FROM people.section s
                  WHERE s.tenant_id = a.tenant_id AND s.key = a.subject), a.subject)
              WHEN a.action IN ('Took a field off sign-up', 'Required a field at sign-up',
                                'Asked a field at sign-up, optional',
                                'Shared a field with the assistant',
                                'Stopped sharing a field with the assistant') THEN coalesce(
                (SELECT d.labels ->> 'default' FROM people.attribute_definition d
                  WHERE d.tenant_id = a.tenant_id AND d.key = a.subject), a.subject)
              ELSE a.subject
            END AS subject
   ) w
  ON CONFLICT (event_id) DO NOTHING;
END $$;
