-- People's outbox for the relay, as `20260927230000_outbox_relay.sql` did
-- identity's: the same generated `topic`, the same publication, the same
-- read-only policy for `svc_debezium`.
--
-- It stands alone, as that one does: People's own test harness applies only
-- the `_people_` migrations, so the role and the publication are made here
-- too when they are missing, and joined when they are not.
ALTER TABLE people.outbox
  ADD COLUMN IF NOT EXISTS topic text
  GENERATED ALWAYS AS ('kithena.' || split_part(event_name, '.', 1) || '.v' || event_version) STORED;

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'svc_debezium') THEN
    CREATE ROLE svc_debezium NOLOGIN NOBYPASSRLS;
  END IF;
  IF EXISTS (SELECT FROM pg_publication WHERE pubname = 'kithena_outbox') THEN
    ALTER PUBLICATION kithena_outbox ADD TABLE people.outbox;
  ELSE
    CREATE PUBLICATION kithena_outbox FOR TABLE people.outbox
      WITH (publish = 'insert', publish_generated_columns = stored);
  END IF;
END $$;

GRANT USAGE ON SCHEMA people TO svc_debezium;
GRANT SELECT ON people.outbox TO svc_debezium;
CREATE POLICY outbox_relay_reads ON people.outbox FOR SELECT TO svc_debezium USING (true);
