-- Time Off's projection of the people it serves (PRD §5.2, TOF-029).
--
-- People owns who a person is, who manages them, where they work and when
-- they started. Time Off keeps only what it needs, translated from People's
-- events when People is present and fed by an import or SCIM when it is not.
-- Nothing here references `people.*`: a module that joined to another
-- module's tables would stop booting alone.

-- `updated_at` for every mutable Time Off table. Time Off's own copy of
-- `platform.touch_updated_at()`, because this module's migrations apply to a
-- database where `platform` may not exist.
CREATE OR REPLACE FUNCTION timeoff.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- ------------------------------------------------------------------ member --
CREATE TABLE timeoff.member (
  tenant_id           uuid NOT NULL,
  person_id           uuid NOT NULL,

  display_name        text NOT NULL,
  -- The kiosk greeting shows this and nothing else (§11.9).
  first_name          text,

  -- The approval chain's "Manager" (§9.1). No foreign key to `member`: a
  -- manager's own row may arrive after their report's.
  manager_person_id   uuid,

  team_key            text,
  team_name           text,

  -- Which holiday layers apply (§10.2) and which statutory rules.
  location_key        text,
  country             char(2),
  region              text,
  city                text,

  -- Calendar dates: pro-rata and tenure count days, not instants.
  hire_date           date,
  termination_date    date,

  -- ISO weekdays worked, 1 is Monday. Null is the policy's default.
  work_pattern        smallint[],

  status              text NOT NULL DEFAULT 'active',

  -- Idempotent, ordered application. The consumer's upsert writes only when
  -- `(last_effective_from, last_event_id)` moves forward, so a redelivered
  -- event changes nothing and an older one arriving late does not undo a
  -- newer one. Event ids are UUIDv7, so the id breaks a tie in time order.
  -- NOT NULL because a null in a row comparison is never "less than", and an
  -- import mints an id and a date like any other source.
  last_event_id       uuid NOT NULL,
  last_effective_from date NOT NULL,

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (tenant_id, person_id),

  CONSTRAINT member_status_known CHECK (status IN ('active', 'on_leave', 'terminated')),
  CONSTRAINT member_left_after_joining CHECK (
    termination_date IS NULL OR hire_date IS NULL OR termination_date >= hire_date
  ),
  CONSTRAINT member_manager_is_somebody_else CHECK (
    manager_person_id IS NULL OR manager_person_id <> person_id
  ),
  CONSTRAINT member_work_pattern_weekdays CHECK (
    work_pattern IS NULL OR work_pattern <@ ARRAY[1, 2, 3, 4, 5, 6, 7]::smallint[]
  )
);

-- "Who reports to this person", for the approval queue and the team calendar.
CREATE INDEX member_manager_idx ON timeoff.member (tenant_id, manager_person_id);
CREATE INDEX member_team_idx    ON timeoff.member (tenant_id, team_key);

ALTER TABLE timeoff.member ENABLE ROW LEVEL SECURITY;
ALTER TABLE timeoff.member FORCE  ROW LEVEL SECURITY;
CREATE POLICY member_tenant_isolation ON timeoff.member
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE TRIGGER member_touch_updated_at
  BEFORE UPDATE ON timeoff.member
  FOR EACH ROW EXECUTE FUNCTION timeoff.touch_updated_at();

-- No DELETE: somebody who left is `terminated`, and their ledger, requests
-- and punches still name them.
GRANT SELECT, INSERT, UPDATE ON timeoff.member TO svc_timeoff;
