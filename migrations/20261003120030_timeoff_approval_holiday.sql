-- Approval rules, delegations, team minimums and holiday calendars
-- (PRD §9.1, §9.3, §9.7, §10.2, TOF-032). Configuration: edited in place,
-- and every decision it led to is recorded elsewhere.

-- ----------------------------------------------------------- approval_rule --
--
-- A sentence: Request → Manager → HR. Resolved to an ordered list of roles;
-- which person holds "manager" is the member projection's business.
CREATE TABLE timeoff.approval_rule (
  tenant_id    uuid NOT NULL,
  key          text NOT NULL,
  subject      text NOT NULL,
  -- Null is every leave type.
  leave_types  text[],
  -- `when` in the domain, which SQL reserves.
  applies_when text NOT NULL DEFAULT 'always',
  -- In order. Empty is approved automatically.
  approvers    text[] NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (tenant_id, key),

  CONSTRAINT approval_rule_key_shape CHECK (key ~ '^[a-z][a-z0-9_]*$' AND length(key) <= 64),
  CONSTRAINT approval_rule_subject_known CHECK (subject IN ('request', 'plan', 'timesheet')),
  CONSTRAINT approval_rule_when_known CHECK (applies_when IN ('always', 'below_zero', 'unpaid')),
  CONSTRAINT approval_rule_approvers_known CHECK (approvers <@ ARRAY['manager', 'hr'])
);

ALTER TABLE timeoff.approval_rule ENABLE ROW LEVEL SECURITY;
ALTER TABLE timeoff.approval_rule FORCE  ROW LEVEL SECURITY;
CREATE POLICY approval_rule_tenant_isolation ON timeoff.approval_rule
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE TRIGGER approval_rule_touch_updated_at
  BEFORE UPDATE ON timeoff.approval_rule
  FOR EACH ROW EXECUTE FUNCTION timeoff.touch_updated_at();

-- A leave type's rule exists. Null still means the tenant's default.
ALTER TABLE timeoff.leave_type
  ADD CONSTRAINT leave_type_approval_rule_fk
  FOREIGN KEY (tenant_id, approval_rule_key) REFERENCES timeoff.approval_rule (tenant_id, key);

-- -------------------------------------------------------------- delegation --
--
-- One per approver, which is what `routeTo` takes. Replacing it is an update;
-- the decisions it covered name it through `request_decision.on_behalf_of`.
CREATE TABLE timeoff.delegation (
  tenant_id          uuid NOT NULL,
  approver_person_id uuid NOT NULL,
  delegate_person_id uuid NOT NULL,
  -- A set range; null for none.
  during             daterange,
  -- Also cover whenever the approver's own time off is approved.
  automatic          boolean NOT NULL DEFAULT false,
  -- Off by default: salary-related requests go to HR instead.
  salary_related     boolean NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (tenant_id, approver_person_id),
  FOREIGN KEY (tenant_id, approver_person_id) REFERENCES timeoff.member (tenant_id, person_id),
  FOREIGN KEY (tenant_id, delegate_person_id) REFERENCES timeoff.member (tenant_id, person_id),

  CONSTRAINT delegation_to_somebody_else CHECK (delegate_person_id <> approver_person_id),
  -- A delegation that never covers is a row pretending to be a setting.
  CONSTRAINT delegation_covers_something CHECK (during IS NOT NULL OR automatic)
);

ALTER TABLE timeoff.delegation ENABLE ROW LEVEL SECURITY;
ALTER TABLE timeoff.delegation FORCE  ROW LEVEL SECURITY;
CREATE POLICY delegation_tenant_isolation ON timeoff.delegation
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE TRIGGER delegation_touch_updated_at
  BEFORE UPDATE ON timeoff.delegation
  FOR EACH ROW EXECUTE FUNCTION timeoff.touch_updated_at();

-- ------------------------------------------------------------ team_minimum --
--
-- "At least N of M in" or "at least P% in, every weekday" (T34).
CREATE TABLE timeoff.team_minimum (
  tenant_id  uuid NOT NULL,
  team_key   text NOT NULL,
  at_least   integer NOT NULL,
  unit       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (tenant_id, team_key),

  CONSTRAINT team_minimum_unit_known CHECK (unit IN ('people', 'percent')),
  CONSTRAINT team_minimum_in_range CHECK (
    at_least >= 1 AND (unit <> 'percent' OR at_least <= 100)
  )
);

ALTER TABLE timeoff.team_minimum ENABLE ROW LEVEL SECURITY;
ALTER TABLE timeoff.team_minimum FORCE  ROW LEVEL SECURITY;
CREATE POLICY team_minimum_tenant_isolation ON timeoff.team_minimum
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE TRIGGER team_minimum_touch_updated_at
  BEFORE UPDATE ON timeoff.team_minimum
  FOR EACH ROW EXECUTE FUNCTION timeoff.touch_updated_at();

-- -------------------------------------------------------- holiday_calendar --
--
-- One layer: national, regional or city. A member gets every layer whose
-- place contains theirs (Madrid = Spain + Comunidad de Madrid + Madrid city),
-- matched on the projection's `country`, `region` and `city`.
CREATE TABLE timeoff.holiday_calendar (
  tenant_id    uuid NOT NULL,
  key          text NOT NULL,
  name         text NOT NULL,
  level        text NOT NULL,
  -- Governs this layer's own days: England moves by rule, Spain publishes
  -- its moved days as dates of their own.
  weekend_rule text NOT NULL DEFAULT 'none',
  country      char(2) NOT NULL,
  region       text,
  city         text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (tenant_id, key),

  CONSTRAINT holiday_calendar_key_shape CHECK (key ~ '^[a-z][a-z0-9_]*$' AND length(key) <= 64),
  CONSTRAINT holiday_calendar_level_known CHECK (level IN ('national', 'regional', 'city')),
  CONSTRAINT holiday_calendar_weekend_rule_known CHECK (weekend_rule IN ('move_to_monday', 'none')),
  -- The place matches the level: a national layer names no region, a city
  -- layer names its region too.
  CONSTRAINT holiday_calendar_place_matches_level CHECK (
    (level = 'national' AND region IS NULL     AND city IS NULL)
    OR (level = 'regional' AND region IS NOT NULL AND city IS NULL)
    OR (level = 'city'     AND region IS NOT NULL AND city IS NOT NULL)
  )
);

ALTER TABLE timeoff.holiday_calendar ENABLE ROW LEVEL SECURITY;
ALTER TABLE timeoff.holiday_calendar FORCE  ROW LEVEL SECURITY;
CREATE POLICY holiday_calendar_tenant_isolation ON timeoff.holiday_calendar
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE TRIGGER holiday_calendar_touch_updated_at
  BEFORE UPDATE ON timeoff.holiday_calendar
  FOR EACH ROW EXECUTE FUNCTION timeoff.touch_updated_at();

-- ----------------------------------------------------------------- holiday --
--
-- A layer's days, as published. The year is the date's; HR maintains each
-- year as it comes. Moving a weekend day is resolved on read, by the layer's
-- rule, so the published date is what is stored.
CREATE TABLE timeoff.holiday (
  tenant_id    uuid NOT NULL,
  calendar_key text NOT NULL,
  day          date NOT NULL,
  name         text NOT NULL,

  PRIMARY KEY (tenant_id, calendar_key, day),
  FOREIGN KEY (tenant_id, calendar_key)
    REFERENCES timeoff.holiday_calendar (tenant_id, key) ON DELETE CASCADE
);

ALTER TABLE timeoff.holiday ENABLE ROW LEVEL SECURITY;
ALTER TABLE timeoff.holiday FORCE  ROW LEVEL SECURITY;
CREATE POLICY holiday_tenant_isolation ON timeoff.holiday
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- ------------------------------------------------------------------ grants --
GRANT SELECT, INSERT, UPDATE, DELETE ON timeoff.approval_rule    TO svc_timeoff;
GRANT SELECT, INSERT, UPDATE, DELETE ON timeoff.delegation       TO svc_timeoff;
GRANT SELECT, INSERT, UPDATE, DELETE ON timeoff.team_minimum     TO svc_timeoff;
GRANT SELECT, INSERT, UPDATE, DELETE ON timeoff.holiday_calendar TO svc_timeoff;
GRANT SELECT, INSERT, UPDATE, DELETE ON timeoff.holiday          TO svc_timeoff;
