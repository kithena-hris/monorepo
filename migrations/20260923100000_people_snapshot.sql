-- Headcount snapshots: what every chart reads instead of the person table.
--
-- §16.4: a daily job writes aggregate counts per tenant per day, and charts
-- read those. Nothing is computed by scanning every person on every page load.
--
-- ### Three tables, one run
--
-- `headcount_snapshot_run` is the grid: one row per tenant per day a snapshot
-- was taken. It exists as its own row so that "a snapshot was taken and the
-- tenant had nobody" is distinguishable from "no snapshot was taken", and so
-- that every run records the day its flows start from.
--
-- `headcount_snapshot` is the cube: counts by department, location, status,
-- employment type, tenure band and completeness, for each scope.
--
-- `headcount_snapshot_measure` holds the one-dimensional distributions the
-- cube cannot: span of control, upcoming expiries, missing fields and the
-- voluntary self-identification answers.
--
-- ### Flows are contiguous, so nothing is counted twice or dropped
--
-- A run's `joiners` and `leavers` cover (flows_from, day], where `flows_from`
-- is the previous run's day. A day the job did not run is therefore not lost —
-- the next run's flows span it — and summing flows over consecutive runs never
-- counts one hire twice. The waterfall reconciles because of this column.
--
-- ### Scope
--
-- `scope_id` is the tenant id for tenant-wide rows and a manager's person id
-- for the counts over that manager's whole reporting chain. One column rather
-- than a nullable one, for the reason `attribute_unique.scope_id` gives.
--
-- ### Small numbers are stored; they are never served
--
-- The measure table holds self-identification counts of one. The cohort
-- minimum is enforced by the query layer, in
-- `services/people/src/application/analytics/`, before a number leaves it —
-- which is what makes it hold in the tooltip and the export as well.

-- ------------------------------------------------------------------- run --
CREATE TABLE people.headcount_snapshot_run (
  tenant_id  uuid NOT NULL,
  day        date NOT NULL,
  -- Flows on this run's rows cover (flows_from, day].
  flows_from date NOT NULL,
  taken_at   timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (tenant_id, day),
  CONSTRAINT snapshot_run_flows_precede_day CHECK (flows_from < day)
);

ALTER TABLE people.headcount_snapshot_run ENABLE ROW LEVEL SECURITY;
ALTER TABLE people.headcount_snapshot_run FORCE  ROW LEVEL SECURITY;
CREATE POLICY headcount_snapshot_run_tenant_isolation ON people.headcount_snapshot_run
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- ------------------------------------------------------------------ cube --
CREATE TABLE people.headcount_snapshot (
  tenant_id       uuid NOT NULL,
  day             date NOT NULL,
  scope_id        uuid NOT NULL,

  -- Text rather than uuid: the value may come from history, and a malformed
  -- one should land in a bucket rather than fail the whole tenant's run.
  department      text,
  location        text,
  status          text NOT NULL,
  employment_type text,
  tenure_band     text NOT NULL,
  completeness    text NOT NULL,

  -- In headcount on `day`.
  headcount       int NOT NULL,
  -- Hired in (flows_from, day].
  joiners         int NOT NULL,
  -- Last working day in [flows_from, day): present at the start of the
  -- interval, gone by its end.
  leavers         int NOT NULL,

  FOREIGN KEY (tenant_id, day) REFERENCES people.headcount_snapshot_run (tenant_id, day),

  CONSTRAINT snapshot_counts_not_negative CHECK (headcount >= 0 AND joiners >= 0 AND leavers >= 0),
  CONSTRAINT snapshot_row_counts_somebody CHECK (headcount + joiners + leavers > 0),
  CONSTRAINT snapshot_status_known CHECK (
    status IN ('active', 'on_leave', 'notice', 'terminated')
  ),
  CONSTRAINT snapshot_tenure_band_known CHECK (
    tenure_band IN ('0_6m', '6_12m', '12_18m', '18_24m', '2_5y', '5y_plus')
  ),
  CONSTRAINT snapshot_completeness_known CHECK (
    completeness IN ('complete', 'incomplete', 'not_applicable')
  )
);

-- Every chart reads one tenant, one scope, one day or a range of days.
CREATE INDEX headcount_snapshot_read_idx
  ON people.headcount_snapshot (tenant_id, scope_id, day);

ALTER TABLE people.headcount_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE people.headcount_snapshot FORCE  ROW LEVEL SECURITY;
CREATE POLICY headcount_snapshot_tenant_isolation ON people.headcount_snapshot
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- --------------------------------------------------------------- measure --
CREATE TABLE people.headcount_snapshot_measure (
  tenant_id uuid NOT NULL,
  day       date NOT NULL,
  scope_id  uuid NOT NULL,
  -- `span`, `missing`, `expiry:<kind>` or `self_id:<attribute key>`.
  measure   text NOT NULL,
  bucket    text NOT NULL,
  count     int  NOT NULL,

  PRIMARY KEY (tenant_id, day, scope_id, measure, bucket),
  FOREIGN KEY (tenant_id, day) REFERENCES people.headcount_snapshot_run (tenant_id, day),

  CONSTRAINT snapshot_measure_counts_somebody CHECK (count > 0)
);

ALTER TABLE people.headcount_snapshot_measure ENABLE ROW LEVEL SECURITY;
ALTER TABLE people.headcount_snapshot_measure FORCE  ROW LEVEL SECURITY;
CREATE POLICY headcount_snapshot_measure_tenant_isolation ON people.headcount_snapshot_measure
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- ---------------------------------------------------------------- grants --
--
-- DELETE because a run taken twice on one day replaces itself: the job is
-- idempotent by deleting the day and writing it again, in one transaction.
GRANT SELECT, INSERT, DELETE ON people.headcount_snapshot_run     TO svc_people;
GRANT SELECT, INSERT, DELETE ON people.headcount_snapshot         TO svc_people;
GRANT SELECT, INSERT, DELETE ON people.headcount_snapshot_measure TO svc_people;
