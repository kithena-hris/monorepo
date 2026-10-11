-- The Documents module's own tables (PRD §17, DOC-016).
--
-- Bytes are not here: a version names a key in the documents bucket, sealed
-- by the service. Nothing here references another module's schema; members
-- are Documents' own projection, as Time Off's are.

CREATE OR REPLACE FUNCTION documents.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- ------------------------------------------------------------------ member --
-- Who works here, from People's events or an import (PRD §5.2).
CREATE TABLE documents.member (
  tenant_id           uuid NOT NULL,
  person_id           uuid NOT NULL,
  account_id          uuid,
  display_name        text NOT NULL,
  work_email          text,
  manager_person_id   uuid,
  team_key            text,
  team_name           text,
  location_key        text,
  hire_date           date,
  termination_date    date,
  status              text NOT NULL DEFAULT 'active',
  last_event_id       uuid NOT NULL,
  last_effective_from date NOT NULL,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, person_id)
);
CREATE INDEX member_account_idx ON documents.member (tenant_id, account_id);
CREATE INDEX member_team_idx ON documents.member (tenant_id, team_key);

-- HR for Documents: the accounts identity names administrator of `module.documents`.
CREATE TABLE documents.hr (
  tenant_id   uuid NOT NULL,
  account_id  uuid NOT NULL,
  PRIMARY KEY (tenant_id, account_id)
);

-- ----------------------------------------------------------- document type --
CREATE TABLE documents.document_type (
  tenant_id     uuid NOT NULL,
  key           text NOT NULL,
  name          text NOT NULL,
  -- The icon and tone family: Contract, Policy, Payslip, Letter, ID, …
  kind          text NOT NULL,
  -- The sentence (PRD §12.1), validated by the domain on every write.
  definition    jsonb NOT NULL,
  archived      boolean NOT NULL DEFAULT false,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, key)
);

-- ---------------------------------------------------------------- section --
CREATE TABLE documents.section (
  tenant_id     uuid NOT NULL,
  id            uuid NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('company', 'personal')),
  -- The account a personal section belongs to; null for a company section.
  owner_account uuid,
  name          text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT section_owner CHECK ((kind = 'personal') = (owner_account IS NOT NULL))
);

CREATE TABLE documents.section_entry (
  tenant_id     uuid NOT NULL,
  section_id    uuid NOT NULL,
  document_id   uuid NOT NULL,
  added_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, section_id, document_id)
);

-- --------------------------------------------------------------- document --
CREATE TABLE documents.document (
  tenant_id         uuid NOT NULL,
  id                uuid NOT NULL,
  title             text NOT NULL,
  -- Null for somebody's own document ("Personal").
  type_key          text,
  -- Whoever created it: the owner (PRD §6.2).
  owner_account     uuid NOT NULL,
  -- The person it is about; null for a company or a personal document.
  subject_person_id uuid,
  level             text NOT NULL CHECK (level IN ('private', 'shared')),
  confidential      boolean NOT NULL DEFAULT false,
  confidential_by   text CHECK (confidential_by IN ('owner', 'hr', 'type')),
  current_version   integer NOT NULL,
  expires_on        date,
  deleted_at        timestamptz,
  deleted_by        uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT document_confidential_by CHECK (confidential = (confidential_by IS NOT NULL))
);
CREATE INDEX document_owner_idx ON documents.document (tenant_id, owner_account);
CREATE INDEX document_subject_idx ON documents.document (tenant_id, subject_person_id);
CREATE INDEX document_expires_idx ON documents.document (tenant_id, expires_on)
  WHERE expires_on IS NOT NULL AND deleted_at IS NULL;

-- Immutable: a new upload is a new row.
CREATE TABLE documents.version (
  tenant_id     uuid NOT NULL,
  document_id   uuid NOT NULL,
  n             integer NOT NULL CHECK (n >= 1),
  blob_key      text NOT NULL,
  file_name     text NOT NULL,
  media_type    text NOT NULL,
  size          bigint NOT NULL CHECK (size >= 0),
  pages         integer,
  checksum      char(64) NOT NULL,
  note          text,
  uploaded_at   timestamptz NOT NULL,
  uploaded_by   uuid NOT NULL,
  PRIMARY KEY (tenant_id, document_id, n)
);

CREATE TABLE documents.grant (
  tenant_id       uuid NOT NULL,
  document_id     uuid NOT NULL,
  principal_kind  text NOT NULL CHECK (principal_kind IN ('member', 'team', 'everyone')),
  -- A person id, a team key, or '*' for everyone.
  principal_id    text NOT NULL,
  permission      text NOT NULL CHECK (permission IN ('view', 'edit')),
  ends_on         date,
  PRIMARY KEY (tenant_id, document_id, principal_kind, principal_id)
);
CREATE INDEX grant_principal_idx ON documents.grant (tenant_id, principal_kind, principal_id);

-- Every open of a confidential document, and every download (PRD §9.2).
CREATE TABLE documents.view_log (
  tenant_id     uuid NOT NULL,
  id            uuid NOT NULL,
  document_id   uuid NOT NULL,
  account_id    uuid NOT NULL,
  action        text NOT NULL CHECK (action IN ('view', 'download')),
  device        text,
  at            timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX view_log_document_idx ON documents.view_log (tenant_id, document_id, at DESC);

-- ---------------------------------------------------------------- requests --
CREATE TABLE documents.access_request (
  tenant_id         uuid NOT NULL,
  id                uuid NOT NULL,
  document_id       uuid NOT NULL,
  requester_account uuid NOT NULL,
  reason            text NOT NULL,
  status            text NOT NULL CHECK (status IN ('open', 'granted', 'refused')),
  created_at        timestamptz NOT NULL,
  decided_at        timestamptz,
  decided_by        uuid,
  PRIMARY KEY (tenant_id, id)
);

-- HR asking a person for a document (PRD §7.4).
CREATE TABLE documents.doc_request (
  tenant_id     uuid NOT NULL,
  id            uuid NOT NULL,
  person_id     uuid NOT NULL,
  type_key      text NOT NULL,
  due_on        date,
  message       text NOT NULL DEFAULT '',
  status        text NOT NULL CHECK (status IN ('open', 'fulfilled', 'cancelled')),
  created_by    uuid NOT NULL,
  created_at    timestamptz NOT NULL,
  reminded_at   timestamptz,
  document_id   uuid,
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX doc_request_person_idx ON documents.doc_request (tenant_id, person_id, status);

-- ------------------------------------------------------------ legal holds --
CREATE TABLE documents.legal_hold (
  tenant_id     uuid NOT NULL,
  id            uuid NOT NULL,
  name          text NOT NULL,
  set_by        uuid NOT NULL,
  set_at        timestamptz NOT NULL,
  lifted_at     timestamptz,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE documents.hold_entry (
  tenant_id     uuid NOT NULL,
  hold_id       uuid NOT NULL,
  document_id   uuid NOT NULL,
  PRIMARY KEY (tenant_id, hold_id, document_id)
);

-- ------------------------------------------------------- activity, settings --
-- Append-only (PRD §12.5).
CREATE TABLE documents.activity (
  tenant_id     uuid NOT NULL,
  id            uuid NOT NULL,
  document_id   uuid,
  account_id    uuid,
  action        text NOT NULL,
  detail        jsonb NOT NULL DEFAULT '{}',
  at            timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX activity_document_idx ON documents.activity (tenant_id, document_id, at DESC);

CREATE TABLE documents.settings (
  tenant_id     uuid NOT NULL,
  key           text NOT NULL,
  value         jsonb NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, key)
);

CREATE TABLE documents.idempotency_key (
  tenant_id     uuid        NOT NULL,
  key           text        NOT NULL,
  request_hash  char(64)    NOT NULL,
  status        smallint    NOT NULL,
  answer        jsonb       NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, key),
  CONSTRAINT idempotency_key_length CHECK (length(key) BETWEEN 1 AND 255)
);

CREATE TRIGGER document_type_touch BEFORE UPDATE ON documents.document_type
  FOR EACH ROW EXECUTE FUNCTION documents.touch_updated_at();
CREATE TRIGGER document_touch BEFORE UPDATE ON documents.document
  FOR EACH ROW EXECUTE FUNCTION documents.touch_updated_at();
CREATE TRIGGER member_touch BEFORE UPDATE ON documents.member
  FOR EACH ROW EXECUTE FUNCTION documents.touch_updated_at();
CREATE TRIGGER settings_touch BEFORE UPDATE ON documents.settings
  FOR EACH ROW EXECUTE FUNCTION documents.touch_updated_at();

-- Every table: the tenant policy, as the bootstrap sets out.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['member', 'hr', 'document_type', 'section', 'section_entry',
    'document', 'version', 'grant', 'view_log', 'access_request', 'doc_request',
    'legal_hold', 'hold_entry', 'activity', 'settings', 'idempotency_key']
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

-- Written once, never changed: versions, the view log, activity, idempotency.
GRANT SELECT, INSERT ON documents.version, documents.view_log, documents.activity,
  documents.idempotency_key TO svc_documents;
GRANT SELECT, INSERT, UPDATE ON documents.document, documents.document_type,
  documents.access_request, documents.doc_request, documents.legal_hold,
  documents.settings TO svc_documents;
-- Deleted rows: a lifted grant, a section entry removed, a projection rewritten.
-- A document's own row is never deleted; destroying it removes its bytes.
GRANT SELECT, INSERT, UPDATE, DELETE ON documents.member, documents.hr, documents.section,
  documents.section_entry, documents.grant, documents.hold_entry TO svc_documents;
