-- The outbox relay: Debezium tails each outbox and publishes every row, as it
-- was written, to the topic its event's contract names. Until now nothing did,
-- so an event reached its outbox and stopped there.
--
-- `topic` is derived exactly as `defineEvent` derives it in
-- `packages/contracts/src/event.ts` (`kithena.<module>.v<version>`, the module
-- being the event name's first segment), so Debezium's outbox router can route
-- by one column. Generated, so no writer can set it wrong and no row predates
-- it. `packages/db-kit/src/outbox.integration.test.ts` fails if the two
-- derivations ever disagree.
ALTER TABLE platform.outbox
  ADD COLUMN IF NOT EXISTS topic text
  GENERATED ALWAYS AS ('kithena.' || split_part(event_name, '.', 1) || '.v' || event_version) STORED;
ALTER TABLE people.outbox
  ADD COLUMN IF NOT EXISTS topic text
  GENERATED ALWAYS AS ('kithena.' || split_part(event_name, '.', 1) || '.v' || event_version) STORED;

-- One publication naming both outboxes, in every database. Each Debezium
-- instance reads only the table whose database is authoritative for it:
-- identity's on Neon, People's on the VM. Inserts only; nothing updates or
-- deletes an outbox row that anyone downstream should hear about.
CREATE PUBLICATION kithena_outbox FOR TABLE platform.outbox, people.outbox
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
-- first starts (or finds its slot gone) is a plain SELECT, and both outboxes
-- force their tenant policy. A policy for this role alone, read-only, rather
-- than BYPASSRLS, which would let it read every table in the database.
GRANT USAGE ON SCHEMA platform, people TO svc_debezium;
GRANT SELECT ON platform.outbox, people.outbox TO svc_debezium;
CREATE POLICY outbox_relay_reads ON platform.outbox FOR SELECT TO svc_debezium USING (true);
CREATE POLICY outbox_relay_reads ON people.outbox FOR SELECT TO svc_debezium USING (true);
