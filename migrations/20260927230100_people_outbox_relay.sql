-- People's outbox for the relay, as `20260927230000_outbox_relay.sql` did
-- identity's: the same generated `topic`, the same publication, the same
-- read-only policy for `svc_debezium`.
ALTER TABLE people.outbox
  ADD COLUMN IF NOT EXISTS topic text
  GENERATED ALWAYS AS ('kithena.' || split_part(event_name, '.', 1) || '.v' || event_version) STORED;

ALTER PUBLICATION kithena_outbox ADD TABLE people.outbox;

GRANT USAGE ON SCHEMA people TO svc_debezium;
GRANT SELECT ON people.outbox TO svc_debezium;
CREATE POLICY outbox_relay_reads ON people.outbox FOR SELECT TO svc_debezium USING (true);
