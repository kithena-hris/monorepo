-- The import ledger: one row per file a tenant has imported.
--
-- §14.5: an import carries a key derived from the file's checksum, and
-- re-uploading the same file reports "already imported" rather than creating
-- four hundred duplicates. The unique constraint below is that rule. The
-- importer claims the key with INSERT ... ON CONFLICT DO NOTHING before it
-- writes a single person, so two uploads of one file race on this index and
-- not on a SELECT: the second waits for the first transaction to end and then
-- finds the row.
--
-- What is held is the checksum, who ran it, how many rows and what happened
-- to them. Never the file and never a value — the blocked-row report is
-- returned to the importer, not stored, for the reason `people.import.*`
-- events carry counts only: a spreadsheet of employees is the most sensitive
-- thing this module handles, and a copy in a table is a copy in every backup.
--
-- Exports have no table. An export is audited by `people.export.completed` on
-- the outbox, and its file lives in object storage behind a signed link.

CREATE TABLE people.import (
  tenant_id    uuid NOT NULL,
  id           uuid NOT NULL,
  -- SHA-256 of the bytes as uploaded, hex.
  checksum     text NOT NULL,
  actor_id     uuid NOT NULL,
  row_count    int  NOT NULL,
  -- created, updated, unchanged, blocked, duplicate, incomplete. Null until done.
  counts       jsonb,
  started_at   timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,

  PRIMARY KEY (tenant_id, id),
  CONSTRAINT import_once_per_file UNIQUE (tenant_id, checksum),
  CONSTRAINT import_checksum_is_sha256 CHECK (checksum ~ '^[0-9a-f]{64}$'),
  CONSTRAINT import_row_count_bounded CHECK (row_count BETWEEN 0 AND 50000)
);

-- The isolation form from 20260922140000_people_bootstrap.sql, unchanged.
ALTER TABLE people.import ENABLE ROW LEVEL SECURITY;
ALTER TABLE people.import FORCE  ROW LEVEL SECURITY;
CREATE POLICY import_tenant_isolation ON people.import
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- No DELETE: the ledger is what makes a re-upload safe, and a row removed is a
-- file that can be imported twice.
GRANT SELECT, INSERT, UPDATE ON people.import TO svc_people;
