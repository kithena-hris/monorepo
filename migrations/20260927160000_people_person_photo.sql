-- A person's photo (People overview): the picture itself, in People's own
-- database, beside the person it shows.
--
-- The browser shrinks a picked image to a 512px square and uploads it to the
-- upload bucket with a presigned PUT, the way an import's file arrives; People
-- reads it back, checks from the bytes that it is a PNG or a JPEG of a sane
-- size, drops its EXIF, XMP, IPTC and comments, and keeps it here. A few tens
-- of kB a person, so a row rather than a second bucket: it is erased with the
-- person, isolated by the same row-level security, and needs no storage of its
-- own on a laptop. It is served only through People, to somebody who may read
-- the person, never from a public URL.
--
-- `checksum` is the SHA-256 of what is stored: the version a URL names, so a
-- browser may cache one for as long as it likes and a new photo is a new URL.

CREATE TABLE people.person_photo (
  tenant_id   uuid        NOT NULL,
  person_id   uuid        NOT NULL,
  media_type  text        NOT NULL,
  bytes       bytea       NOT NULL,
  checksum    text        NOT NULL,
  updated_at  timestamptz NOT NULL,
  -- The account that chose it: the person, or HR.
  updated_by  uuid        NOT NULL,

  PRIMARY KEY (tenant_id, person_id),
  FOREIGN KEY (tenant_id, person_id) REFERENCES people.person (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT person_photo_type CHECK (media_type IN ('image/png', 'image/jpeg')),
  CONSTRAINT person_photo_size CHECK (octet_length(bytes) BETWEEN 1 AND 524288),
  CONSTRAINT person_photo_checksum_is_sha256 CHECK (checksum ~ '^[0-9a-f]{64}$')
);

-- The isolation form from 20260922140000_people_bootstrap.sql, unchanged.
ALTER TABLE people.person_photo ENABLE ROW LEVEL SECURITY;
ALTER TABLE people.person_photo FORCE  ROW LEVEL SECURITY;
CREATE POLICY person_photo_tenant_isolation ON people.person_photo
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON people.person_photo TO svc_people;

-- A photo's upload waits where an import's does, under its own purpose, so
-- starting one never lets go of the other. Expand only: a wider CHECK.
ALTER TABLE people.import_upload DROP CONSTRAINT import_upload_purpose;
ALTER TABLE people.import_upload
  ADD CONSTRAINT import_upload_purpose CHECK (purpose IN ('import', 'photo'));
