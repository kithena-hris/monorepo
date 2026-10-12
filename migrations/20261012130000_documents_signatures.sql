-- Signatures and acknowledgements (Documents PRD §10, §11; DOC-041 to DOC-048).
--
-- An envelope is kept whole — its signers and fields as JSON, written by the
-- service in one statement — with one row per signer beside it, so a signer
-- is found by the person they are or by their link's token without reading
-- every envelope. Its trail is append-only: the certificate of completion is
-- drawn from it.

CREATE TABLE documents.envelope (
  tenant_id       uuid NOT NULL,
  id              uuid NOT NULL,
  document_id     uuid NOT NULL,
  version         integer NOT NULL,
  sender_account  uuid NOT NULL,
  status          text NOT NULL CHECK (status IN ('sent', 'completed', 'declined', 'voided')),
  body            jsonb NOT NULL,
  due_on          date,
  created_at      timestamptz NOT NULL,
  completed_at    timestamptz,
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX envelope_document_idx ON documents.envelope (tenant_id, document_id);
CREATE INDEX envelope_open_idx ON documents.envelope (tenant_id, status) WHERE status = 'sent';

CREATE TABLE documents.envelope_signer (
  tenant_id     uuid NOT NULL,
  envelope_id   uuid NOT NULL,
  signer_id     text NOT NULL,
  person_id     uuid,
  token_hash    char(64) NOT NULL,
  status        text NOT NULL,
  PRIMARY KEY (tenant_id, envelope_id, signer_id)
);
CREATE INDEX envelope_signer_person_idx ON documents.envelope_signer (tenant_id, person_id);
CREATE UNIQUE INDEX envelope_signer_token_idx ON documents.envelope_signer (tenant_id, token_hash);

CREATE TABLE documents.envelope_event (
  tenant_id     uuid NOT NULL,
  id            uuid NOT NULL,
  envelope_id   uuid NOT NULL,
  signer_id     text,
  action        text NOT NULL,
  detail        jsonb NOT NULL DEFAULT '{}',
  at            timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX envelope_event_idx ON documents.envelope_event (tenant_id, envelope_id, at);

CREATE TABLE documents.campaign (
  tenant_id     uuid NOT NULL,
  id            uuid NOT NULL,
  document_id   uuid NOT NULL,
  version       integer NOT NULL,
  audience      jsonb NOT NULL,
  due_on        date,
  sent_by       uuid NOT NULL,
  created_at    timestamptz NOT NULL,
  closed_at     timestamptz,
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX campaign_document_idx ON documents.campaign (tenant_id, document_id);

CREATE TABLE documents.acknowledgement (
  tenant_id     uuid NOT NULL,
  campaign_id   uuid NOT NULL,
  person_id     uuid NOT NULL,
  at            timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, campaign_id, person_id)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['envelope', 'envelope_signer', 'envelope_event', 'campaign', 'acknowledgement']
  LOOP
    EXECUTE format('ALTER TABLE documents.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE documents.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON documents.%I '
      'USING (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid) '
      'WITH CHECK (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid)',
      t || '_tenant_isolation', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT ON documents.envelope_event, documents.acknowledgement TO svc_documents;
GRANT SELECT, INSERT, UPDATE ON documents.envelope, documents.campaign TO svc_documents;
GRANT SELECT, INSERT, UPDATE, DELETE ON documents.envelope_signer TO svc_documents;
