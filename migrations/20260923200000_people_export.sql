-- The export ledger: one row per export a tenant has asked for.
--
-- 20260923130000 said exports have no table, and for an export that ran while
-- the requester waited that was true. An export over 2,000 rows runs as a job
-- (§15.1), and a job needs two things the outbox cannot give it:
--
-- - **Idempotency on the export id.** A retried job must not store, announce
--   or notify twice. Completion is an upsert guarded by `completed_at IS
--   NULL`, so the second attempt to complete the same export changes nothing
--   and says so.
-- - **Somewhere for the requester to come back to.** `GET /v1/exports/{id}`
--   re-signs the links from the file names and the expiry held here, for the
--   person who asked and nobody else.
--
-- What is held is who asked, how many rows, the file names and when the links
-- die. Never a value, never a link and never the file: the file lives in
-- object storage behind the link, and a link is re-derived rather than stored
-- so that this table in a backup opens nothing.

CREATE TABLE people.export (
  tenant_id    uuid NOT NULL,
  id           uuid NOT NULL,
  requested_by uuid NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  -- Null until the job has run.
  row_count    int,
  file_names   text[],
  expires_at   timestamptz,
  completed_at timestamptz,

  PRIMARY KEY (tenant_id, id),
  CONSTRAINT export_completed_whole CHECK (
    (completed_at IS NULL) = (row_count IS NULL)
    AND (completed_at IS NULL) = (file_names IS NULL)
    AND (completed_at IS NULL) = (expires_at IS NULL)
  )
);

-- The isolation form from 20260922140000_people_bootstrap.sql, unchanged.
ALTER TABLE people.export ENABLE ROW LEVEL SECURITY;
ALTER TABLE people.export FORCE  ROW LEVEL SECURITY;
CREATE POLICY export_tenant_isolation ON people.export
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- No DELETE: the ledger row outlives the file, as the audit event does.
GRANT SELECT, INSERT, UPDATE ON people.export TO svc_people;
