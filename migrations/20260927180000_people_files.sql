-- Files on a record: an `image` or `document_ref` field's upload, and the
-- company's choice to ask for a photo when somebody signs up.
--
-- **A file, in People's own database, beside the person.** An image or a
-- document a field asks for is uploaded the way a photo is (a presigned PUT to
-- the upload bucket, then People reads it back, checks from the bytes what it
-- is, drops a camera's metadata from an image) and kept here, erased with the
-- person and isolated by the same row-level security. The field's value is
-- this row's id. It is served only through People, to somebody who may read
-- that field on that person.
--
-- ponytail: bytea in the row, capped by the field (5 MB an image, 10 MB a
-- document by default). A Documents module, or object storage with its own
-- retention and scanning, takes over when files grow past what a row should
-- hold.

CREATE TABLE people.person_file (
  tenant_id     uuid        NOT NULL,
  id            uuid        NOT NULL,
  person_id     uuid        NOT NULL,
  -- The field it was uploaded for: its reader is whoever may read that field.
  attribute_key text        NOT NULL,
  name          text        NOT NULL,
  media_type    text        NOT NULL,
  bytes         bytea       NOT NULL,
  checksum      text        NOT NULL,
  uploaded_at   timestamptz NOT NULL,
  -- The account that uploaded it: the person, or HR.
  uploaded_by   uuid        NOT NULL,

  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, person_id) REFERENCES people.person (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT person_file_type
    CHECK (media_type IN ('image/png', 'image/jpeg', 'application/pdf')),
  CONSTRAINT person_file_size CHECK (octet_length(bytes) BETWEEN 1 AND 104857600),
  CONSTRAINT person_file_name CHECK (length(name) BETWEEN 1 AND 255),
  CONSTRAINT person_file_checksum_is_sha256 CHECK (checksum ~ '^[0-9a-f]{64}$')
);

CREATE INDEX person_file_person_idx ON people.person_file (tenant_id, person_id);

-- The isolation form from 20260922140000_people_bootstrap.sql, unchanged.
ALTER TABLE people.person_file ENABLE ROW LEVEL SECURITY;
ALTER TABLE people.person_file FORCE  ROW LEVEL SECURITY;
CREATE POLICY person_file_tenant_isolation ON people.person_file
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON people.person_file TO svc_people;

-- A field's upload waits where a photo's does, under its own purpose.
-- Expand only: a wider CHECK.
ALTER TABLE people.import_upload DROP CONSTRAINT import_upload_purpose;
ALTER TABLE people.import_upload
  ADD CONSTRAINT import_upload_purpose CHECK (purpose IN ('import', 'photo', 'file'));

-- Whether the first screen after signing up asks for a photo: not at all, as
-- something they may skip, or before anything else. A constant default, so
-- Postgres adds it without rewriting the table.
ALTER TABLE people.tenant_settings
  ADD COLUMN photo_at_signup text NOT NULL DEFAULT 'off'
  CONSTRAINT tenant_settings_photo_at_signup CHECK (photo_at_signup IN ('off', 'optional', 'required'));
