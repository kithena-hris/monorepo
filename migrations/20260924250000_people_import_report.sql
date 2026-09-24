-- Which people an import's stored blocked-row report contains (PEO-090).
--
-- The report itself is not here. It holds employee values as uploaded, so it
-- lives only sealed in object storage (AES-256-GCM in the service, SSE in the
-- bucket), keyed by the import's checksum, for 7 days. This row is what lets
-- it be found and deleted early:
--
-- - **Erasure.** When a person is anonymised, every report containing them is
--   deleted, object and row, found here by `person_ids @> ARRAY[id]` — exact,
--   rather than by opening every report to look.
-- - **Re-upload.** A second upload of the same file is handed a link to the
--   report while `expires_at` is ahead, and told it has expired after.
--
-- Person ids only: never a value, never the file, never a link. A row outliving
-- its object by a while holds nothing an id list elsewhere does not.

CREATE TABLE people.import_report (
  tenant_id  uuid        NOT NULL,
  -- The import key: SHA-256 of the file as uploaded, hex.
  checksum   text        NOT NULL,
  person_ids uuid[]      NOT NULL,
  stored_at  timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,

  PRIMARY KEY (tenant_id, checksum),
  CONSTRAINT import_report_checksum_is_sha256 CHECK (checksum ~ '^[0-9a-f]{64}$'),
  CONSTRAINT import_report_expires_after_stored CHECK (expires_at > stored_at)
);

CREATE INDEX import_report_person_ids ON people.import_report USING gin (person_ids);

-- The isolation form from 20260922140000_people_bootstrap.sql, unchanged.
ALTER TABLE people.import_report ENABLE ROW LEVEL SECURITY;
ALTER TABLE people.import_report FORCE  ROW LEVEL SECURITY;
CREATE POLICY import_report_tenant_isolation ON people.import_report
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- DELETE, unlike the ledger: erasing a person deletes the rows naming them.
GRANT SELECT, INSERT, UPDATE, DELETE ON people.import_report TO svc_people;
