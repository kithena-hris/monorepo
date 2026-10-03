-- What the Drizzle repositories need beyond TOF-029 – TOF-033 (TOF-034).
--
-- The application's ports (`services/timeoff/src/application/ports.ts`) came
-- after the tables and hold a few things the tables did not: the member's
-- zone, a deleted leave type, where a request sits in its approval chain,
-- which holiday layers a location observes, two tenant settings, overtime
-- decisions and the calendar feed's revocation counter. Each is added here,
-- expand only. Two constraints are relaxed rather than met, and each says why.

-- ------------------------------------------------------------------ member --
--
-- "Today" is the member's (TOF-035). IANA names; 'UTC' until a location or
-- an import says otherwise.
ALTER TABLE timeoff.member ADD COLUMN time_zone text NOT NULL DEFAULT 'UTC';

-- -------------------------------------------------------------- leave_type --
--
-- A deleted type keeps its row: the ledger and old requests name it.
ALTER TABLE timeoff.leave_type ADD COLUMN deleted_at timestamptz;

-- ----------------------------------------------------------------- request --
--
-- Where a request sits in its approval chain, which the aggregate does not
-- hold (`Routing` in ports.ts): the roles still to approve, the one waiting
-- now, the day it started waiting (escalation counts from it), and who it
-- went to once nobody decided in time — a person, or 'hr'.
ALTER TABLE timeoff.request
  ADD COLUMN approval_chain text[] NOT NULL DEFAULT '{}',
  ADD COLUMN approval_step  integer NOT NULL DEFAULT 0,
  ADD COLUMN waiting_since  date,
  ADD COLUMN escalated_to   text,
  -- The account that suggested other dates, which approves them when accepted.
  ADD COLUMN proposed_by    text,
  ADD CONSTRAINT request_approval_chain_known CHECK (approval_chain <@ ARRAY['manager', 'hr']),
  ADD CONSTRAINT request_approval_step_in_chain CHECK (
    approval_step >= 0 AND approval_step <= cardinality(approval_chain)
  ),
  ADD CONSTRAINT request_escalated_to_known CHECK (
    escalated_to IS NULL
    OR escalated_to = 'hr'
    OR escalated_to ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  );

-- -------------------------------------------------------- holiday_calendar --
--
-- Which layers a member gets is assigned per work location (`HolidayStore.assign`,
-- §10.2) rather than matched on the place columns, and the domain's layer
-- carries no place. So the place is optional, and no longer has to match the
-- level: relaxed, not dropped, so a layer that does name its place keeps it.
ALTER TABLE timeoff.holiday_calendar ALTER COLUMN country DROP NOT NULL;
ALTER TABLE timeoff.holiday_calendar DROP CONSTRAINT holiday_calendar_place_matches_level;

-- The layers a location observes, most general first.
CREATE TABLE timeoff.location_holiday_calendar (
  tenant_id    uuid NOT NULL,
  location_key text NOT NULL,
  calendar_key text NOT NULL,
  position     smallint NOT NULL,

  PRIMARY KEY (tenant_id, location_key, calendar_key),
  FOREIGN KEY (tenant_id, calendar_key)
    REFERENCES timeoff.holiday_calendar (tenant_id, key) ON DELETE CASCADE,
  CONSTRAINT location_holiday_calendar_position_once UNIQUE (tenant_id, location_key, position)
);

ALTER TABLE timeoff.location_holiday_calendar ENABLE ROW LEVEL SECURITY;
ALTER TABLE timeoff.location_holiday_calendar FORCE  ROW LEVEL SECURITY;
CREATE POLICY location_holiday_calendar_tenant_isolation ON timeoff.location_holiday_calendar
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- ----------------------------------------------------------------- setting --
--
-- One document per setting the tenant has one of: when requests approve
-- themselves (`AutoApproval`), and the working-time rules (`AttendanceRules`).
-- Absent is the domain's default.
CREATE TABLE timeoff.setting (
  tenant_id  uuid NOT NULL,
  key        text NOT NULL,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (tenant_id, key),
  CONSTRAINT setting_key_known CHECK (key IN ('auto_approval', 'attendance_rules')),
  CONSTRAINT setting_value_is_an_object CHECK (jsonb_typeof(value) = 'object')
);

ALTER TABLE timeoff.setting ENABLE ROW LEVEL SECURITY;
ALTER TABLE timeoff.setting FORCE  ROW LEVEL SECURITY;
CREATE POLICY setting_tenant_isolation ON timeoff.setting
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE TRIGGER setting_touch_updated_at
  BEFORE UPDATE ON timeoff.setting
  FOR EACH ROW EXECUTE FUNCTION timeoff.touch_updated_at();

-- ------------------------------------------------------- overtime_decision --
--
-- A day's overtime, decided once by a manager (§11.6): banked, paid or
-- declined. What it became is in `pay_period_line` and the ledger; this is
-- the decision, which the timesheet shows and which stops a second one.
CREATE TABLE timeoff.overtime_decision (
  tenant_id  uuid NOT NULL,
  person_id  uuid NOT NULL,
  day        date NOT NULL,
  minutes    integer NOT NULL,
  outcome    text NOT NULL,
  -- The account that decided.
  decided_by text NOT NULL,
  decided_at timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (tenant_id, person_id, day),
  FOREIGN KEY (tenant_id, person_id) REFERENCES timeoff.member (tenant_id, person_id),
  CONSTRAINT overtime_decision_outcome_known CHECK (outcome IN ('comp', 'paid', 'declined')),
  CONSTRAINT overtime_decision_minutes_positive CHECK (minutes > 0)
);

ALTER TABLE timeoff.overtime_decision ENABLE ROW LEVEL SECURITY;
ALTER TABLE timeoff.overtime_decision FORCE  ROW LEVEL SECURITY;
CREATE POLICY overtime_decision_tenant_isolation ON timeoff.overtime_decision
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- ------------------------------------------------------------ feed_version --
--
-- The revocation counter behind a calendar feed token (§10.1): a token signed
-- for an older version no longer opens the feed.
CREATE TABLE timeoff.feed_version (
  tenant_id uuid NOT NULL,
  person_id uuid NOT NULL,
  version   integer NOT NULL DEFAULT 0,

  PRIMARY KEY (tenant_id, person_id),
  CONSTRAINT feed_version_not_negative CHECK (version >= 0)
);

ALTER TABLE timeoff.feed_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE timeoff.feed_version FORCE  ROW LEVEL SECURITY;
CREATE POLICY feed_version_tenant_isolation ON timeoff.feed_version
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- ---------------------------------------------------------------- location --
--
-- Work locations as People's `people.location.*` events describe them (TOF-045):
-- a member's `org_changed` names a location by id, and this is how it becomes
-- their country and zone. Fed by the consumer; nothing else writes it.
CREATE TABLE timeoff.location (
  tenant_id    uuid NOT NULL,
  location_key text NOT NULL,
  name         text NOT NULL,
  country      char(2),
  time_zone    text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (tenant_id, location_key)
);

ALTER TABLE timeoff.location ENABLE ROW LEVEL SECURITY;
ALTER TABLE timeoff.location FORCE  ROW LEVEL SECURITY;
CREATE POLICY location_tenant_isolation ON timeoff.location
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE TRIGGER location_touch_updated_at
  BEFORE UPDATE ON timeoff.location
  FOR EACH ROW EXECUTE FUNCTION timeoff.touch_updated_at();

-- -------------------------------------------------------------- pay_period --
--
-- The domain's `PayPeriod` does not yet say who closed it, so `closed_by` is
-- set when it is known and never without a close. Relaxed from "both or
-- neither"; restore that when closing carries its account.
ALTER TABLE timeoff.pay_period DROP CONSTRAINT pay_period_closed_by_somebody;
ALTER TABLE timeoff.pay_period ADD CONSTRAINT pay_period_closed_by_only_when_closed CHECK (
  closed_by IS NULL OR closed_at IS NOT NULL
);

-- ------------------------------------------------------------------ tenant --
--
-- The tenants background work runs for (TOF-043): People's `people.tenant`,
-- for the same reasons and with the same split policy
-- (`20260923160000_people_tenant.sql`). Reading is unscoped, because a table
-- that lists tenants cannot answer for one; writing is scoped, so a unit of
-- work registers only the tenant it runs as. Recorded whenever a member is
-- saved: a tenant with no member has nothing for a job to do.
CREATE TABLE timeoff.tenant (
  tenant_id     uuid PRIMARY KEY,
  first_seen_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO timeoff.tenant (tenant_id)
SELECT DISTINCT tenant_id FROM timeoff.member
ON CONFLICT DO NOTHING;

ALTER TABLE timeoff.tenant ENABLE ROW LEVEL SECURITY;
ALTER TABLE timeoff.tenant FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_list ON timeoff.tenant
  FOR SELECT
  USING (true);
CREATE POLICY tenant_register ON timeoff.tenant
  FOR INSERT
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- ------------------------------------------------------------------ grants --
GRANT SELECT, INSERT, UPDATE, DELETE ON timeoff.location_holiday_calendar TO svc_timeoff;
GRANT SELECT, INSERT, UPDATE         ON timeoff.setting                   TO svc_timeoff;
GRANT SELECT, INSERT                 ON timeoff.overtime_decision         TO svc_timeoff;
GRANT SELECT, INSERT, UPDATE         ON timeoff.feed_version              TO svc_timeoff;
GRANT SELECT, INSERT, UPDATE         ON timeoff.location                  TO svc_timeoff;
GRANT SELECT, INSERT                 ON timeoff.tenant                    TO svc_timeoff;
