-- The outbox relay: Debezium tails each outbox and publishes every row, as it
-- was written, to the topic its event's contract names. Until now nothing did,
-- so an event reached its outbox and stopped there.
--
-- Identity's half; People's outbox joins the publication in
-- `20260927230100_people_outbox_relay.sql`, so a database without People
-- (identity's own test harness) applies this one alone.
--
-- `topic` is derived exactly as `defineEvent` derives it in
-- `packages/contracts/src/event.ts` (`kithena.<module>.v<version>`, the module
-- being the event name's first segment), so Debezium's outbox router can route
-- by one column. Generated, so no writer can set it wrong and no row predates
-- it. `packages/db-kit/src/outbox-topic.test.ts` fails if the two derivations
-- ever disagree.
ALTER TABLE platform.outbox
  ADD COLUMN IF NOT EXISTS topic text
  GENERATED ALWAYS AS ('kithena.' || split_part(event_name, '.', 1) || '.v' || event_version) STORED;

-- One publication for every outbox, in every database. Each Debezium instance
-- reads only the table whose database is authoritative for it: identity's on
-- Neon, People's on the VM. Inserts only; nothing updates or deletes an outbox
-- row that anyone downstream should hear about. Generated columns included:
-- Postgres 18 leaves them out by default, and `topic` is the routing key.
CREATE PUBLICATION kithena_outbox FOR TABLE platform.outbox
  WITH (publish = 'insert', publish_generated_columns = stored);

-- Made here, NOLOGIN, so no list of roles a migration needs beforehand has to
-- learn it. Its login and REPLICATION come from whoever may grant them: on the
-- VM `deploy.sh migrate`, as the superuser; on Neon, by hand
-- (docs/environments.md).
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'svc_debezium') THEN
    CREATE ROLE svc_debezium NOLOGIN NOBYPASSRLS;
  END IF;
END $$;

-- `svc_debezium` reads the outboxes and nothing else. Logical decoding does
-- not pass through row-level security, but the snapshot Debezium takes when it
-- first starts (or finds its slot gone) is a plain SELECT, and the outboxes
-- force their tenant policy. A policy for this role alone, read-only, rather
-- than BYPASSRLS, which would let it read every table in the database.
GRANT USAGE ON SCHEMA platform TO svc_debezium;
GRANT SELECT ON platform.outbox TO svc_debezium;
CREATE POLICY outbox_relay_reads ON platform.outbox FOR SELECT TO svc_debezium USING (true);
