-- An import's upload, from the browser straight to object storage (PRD §14.2).
--
-- One row per intent to upload: who asked, for which tenant, what for, how
-- big, and until when. People chooses the object's key and presigns a PUT for
-- exactly that key and that length; the constraint below keeps the key the one
-- the id implies, so no row can point the bucket anywhere else. The file itself
-- is never here — only its name as the browser gave it (shown back on the
-- screens) and, once it has arrived and been checked, its SHA-256.
--
-- Deleted on commit, when the same person starts another upload, or once
-- expired: when anybody in the tenant next starts one, and in the bucket by the
-- hourly sweep and the bucket's lifecycle rule.

CREATE TABLE people.import_upload (
  tenant_id      uuid        NOT NULL,
  id             uuid        NOT NULL,
  actor_id       uuid        NOT NULL,
  purpose        text        NOT NULL,
  name           text        NOT NULL,
  size           bigint      NOT NULL,
  object_key     text        NOT NULL,
  created_at     timestamptz NOT NULL,
  url_expires_at timestamptz NOT NULL,
  expires_at     timestamptz NOT NULL,
  -- SHA-256 of what arrived, hex; null until the upload is completed.
  checksum       text,

  PRIMARY KEY (tenant_id, id),
  CONSTRAINT import_upload_purpose CHECK (purpose = 'import'),
  CONSTRAINT import_upload_size CHECK (size BETWEEN 1 AND 104857600),
  CONSTRAINT import_upload_name CHECK (length(name) BETWEEN 1 AND 255),
  CONSTRAINT import_upload_key_is_its_own
    CHECK (object_key = tenant_id::text || '/' || purpose || '/' || id::text),
  CONSTRAINT import_upload_checksum_is_sha256 CHECK (checksum ~ '^[0-9a-f]{64}$'),
  CONSTRAINT import_upload_expiry_order
    CHECK (created_at < url_expires_at AND url_expires_at <= expires_at)
);

CREATE INDEX import_upload_actor ON people.import_upload (tenant_id, actor_id);

-- The isolation form from 20260922140000_people_bootstrap.sql, unchanged.
ALTER TABLE people.import_upload ENABLE ROW LEVEL SECURITY;
ALTER TABLE people.import_upload FORCE  ROW LEVEL SECURITY;
CREATE POLICY import_upload_tenant_isolation ON people.import_upload
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON people.import_upload TO svc_people;
