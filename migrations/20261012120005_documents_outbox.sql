-- Documents' transactional outbox, read by the relay.
--
-- People's outbox as `20260922170000_people_person.sql` made it and
-- `20260927230100_people_outbox_relay.sql` joined it to the relay, in one
-- file: the columns `outboxTable('documents')` writes, the tenant policy, the
-- generated `topic` the router publishes to, and the read-only policy for
-- `svc_debezium`. Self-sufficient, like the People relay migration, so
-- Documents' own test harness can apply its migrations and nothing else.

CREATE TABLE documents.outbox (
  event_id       uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL,
  event_name     text NOT NULL,
  event_version  text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id   text NOT NULL,
  -- `tenantId:aggregateId`, which keeps one document's events in order.
  partition_key  text NOT NULL,
  envelope       jsonb NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  topic          text GENERATED ALWAYS AS
    ('kithena.' || split_part(event_name, '.', 1) || '.v' || event_version) STORED
);

CREATE INDEX documents_outbox_created_idx ON documents.outbox (created_at);

ALTER TABLE documents.outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents.outbox FORCE  ROW LEVEL SECURITY;
CREATE POLICY documents_outbox_tenant_isolation ON documents.outbox
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- Written and never removed by this service: the relay consumes a row.
GRANT SELECT, INSERT ON documents.outbox TO svc_documents;

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'svc_debezium') THEN
    CREATE ROLE svc_debezium NOLOGIN NOBYPASSRLS;
  END IF;
  IF EXISTS (SELECT FROM pg_publication WHERE pubname = 'kithena_outbox') THEN
    ALTER PUBLICATION kithena_outbox ADD TABLE documents.outbox;
  ELSE
    CREATE PUBLICATION kithena_outbox FOR TABLE documents.outbox
      WITH (publish = 'insert', publish_generated_columns = stored);
  END IF;
END $$;

GRANT USAGE ON SCHEMA documents TO svc_debezium;
GRANT SELECT ON documents.outbox TO svc_debezium;
CREATE POLICY outbox_relay_reads ON documents.outbox FOR SELECT TO svc_debezium USING (true);
