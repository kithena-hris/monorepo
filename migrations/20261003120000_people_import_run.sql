-- An approved import, run in the background (docs/ai-settings.md, "Approve
-- and run").
--
-- A thousand people take minutes, far past what a request may wait, so
-- "Approve and run" records a run here and answers at once. The run is worked
-- through in chunks — setup and fields, then people a batch at a time, then
-- their managers, then their employment status — and each chunk commits its
-- writes and its progress (`phase`, `done`) together. A run picked up again
-- after a restart, a deploy or the VM's stop starts at the next chunk, so
-- nobody is created twice.
--
-- Counts and words only, as `people.import` holds: never a value, never the
-- file. What the run needs that does hold values (the approved plan, the
-- rows as classified, each batch's outcome, the result) is sealed in the
-- object store under `imports/`, for a week at most.
--
-- One active run per company: the partial unique index is the rule, so two
-- approvals racing each other cannot both start one.
--
-- Expand only: a new table.

CREATE TABLE people.import_run (
  tenant_id   uuid NOT NULL,
  -- Also the id of the `people.import` row the run writes when it finishes.
  id          uuid NOT NULL,
  upload_id   uuid NOT NULL,
  -- Who approved it: the run acts as them.
  actor_id    uuid NOT NULL,
  -- The file's name as uploaded, for the history.
  name        text,
  status      text NOT NULL DEFAULT 'queued',
  phase       text NOT NULL DEFAULT 'setup',
  -- Rows done in the current phase, and rows in the file once it is read.
  done        int  NOT NULL DEFAULT 0,
  total       int,
  -- The people phase's tallies so far: created, updated, unchanged, blocked,
  -- duplicate, incomplete. Then, once finished, the import's counts.
  counts      jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- The new fields its setup added, once set up: the finished notice says so.
  fields      int,
  -- Why it failed, in words. Never a value.
  failure     text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  started_at  timestamptz,
  finished_at timestamptz,

  PRIMARY KEY (tenant_id, id),
  CONSTRAINT import_run_status_known
    CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  CONSTRAINT import_run_phase_known
    CHECK (phase IN ('setup', 'people', 'managers', 'lifecycle', 'finishing')),
  CONSTRAINT import_run_done_bounded CHECK (done >= 0 AND (total IS NULL OR done <= total)),
  CONSTRAINT import_run_total_bounded CHECK (total IS NULL OR total BETWEEN 0 AND 50000),
  CONSTRAINT import_run_failure_when_failed CHECK ((status = 'failed') = (failure IS NOT NULL)),
  CONSTRAINT import_run_name CHECK (name IS NULL OR length(name) BETWEEN 1 AND 255)
);

CREATE UNIQUE INDEX import_run_one_active ON people.import_run (tenant_id)
  WHERE status IN ('queued', 'running');
-- The approver's finished runs, for their notices.
CREATE INDEX import_run_actor ON people.import_run (tenant_id, actor_id, finished_at);

-- The isolation form from 20260922140000_people_bootstrap.sql, unchanged.
ALTER TABLE people.import_run ENABLE ROW LEVEL SECURITY;
ALTER TABLE people.import_run FORCE  ROW LEVEL SECURITY;
CREATE POLICY import_run_tenant_isolation ON people.import_run
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- No DELETE: a run is the record of an approval.
GRANT SELECT, INSERT, UPDATE ON people.import_run TO svc_people;
