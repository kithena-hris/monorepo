-- What a person is missing, and when they were last emailed about it.
--
-- One row per person, kept for as long as the person is, and that lifetime is
-- the point. §8.4 caps reminders at one email per person per week regardless
-- of how many fields are missing, and the cap has to survive three things a
-- process-local timestamp would not: a restart, a second worker, and a person
-- who closes every gap on Monday and gains a new one on Wednesday. A row that
-- was deleted when the record became complete would forget Monday's email, so
-- the row stays and its key arrays empty instead.
--
-- `employee_keys` is the employee's task: a banner, an item in their list, and
-- the reminder. `staff_keys` is HR's, and it is never a task per person —
-- `unnest(staff_keys)` grouped by key is the one grid "88 people are missing a
-- cost centre" is read from.
--
-- The cap itself is enforced by a conditional UPDATE on `reminded_at`, not by
-- a read followed by a write. Two sweeps racing for the same row serialise on
-- its lock, and the second re-evaluates the condition against the first one's
-- write and claims nothing.
CREATE TABLE people.completeness_gap (
  tenant_id       uuid NOT NULL,
  person_id       uuid NOT NULL,
  -- The version the gap was computed under.
  schema_version  int NOT NULL,
  employee_keys   text[] NOT NULL DEFAULT '{}',
  staff_keys      text[] NOT NULL DEFAULT '{}',
  reminded_at     timestamptz,
  reminders_sent  int NOT NULL DEFAULT 0,
  updated_at      timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (tenant_id, person_id),
  -- The same tenant, because the composite key is what makes it so. A
  -- discarded provisional record is the one person a hard delete may follow,
  -- and its gap row goes with it.
  FOREIGN KEY (tenant_id, person_id) REFERENCES people.person (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT completeness_gap_count_nonnegative CHECK (reminders_sent >= 0),
  CONSTRAINT completeness_gap_reminded_when_counted CHECK ((reminded_at IS NULL) = (reminders_sent = 0))
);

ALTER TABLE people.completeness_gap ENABLE ROW LEVEL SECURITY;
ALTER TABLE people.completeness_gap FORCE  ROW LEVEL SECURITY;
CREATE POLICY completeness_gap_tenant_isolation ON people.completeness_gap
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- No DELETE: the row outlives the gap, for the reason at the top.
GRANT SELECT, INSERT, UPDATE ON people.completeness_gap TO svc_people;
