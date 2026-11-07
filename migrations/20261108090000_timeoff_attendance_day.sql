-- Each member's worked days, kept as the reports read them (§11.7, §11.8,
-- Insights): the status, the minutes worked and over, and a rest shorter than
-- the rules allow. HR's exceptions, the pay period and Insights read these
-- instead of the punches, which for a company of thousands over a month was
-- hundreds of thousands of rows per page.
--
-- Derived, never a record: a punch, a correction or a kiosk replay rewrites
-- the member's days around it in the same transaction, and the punches stay
-- the truth. Only a day with a shift is kept. A `live` day is the one time
-- alone can change (a forgotten clock-out becomes `open` at midnight); a
-- report asks it again when it reads it.
CREATE TABLE timeoff.attendance_day (
  tenant_id        uuid NOT NULL,
  person_id        uuid NOT NULL,
  date             date NOT NULL,
  status           text NOT NULL,
  worked_minutes   integer,
  overtime_minutes integer NOT NULL DEFAULT 0,
  rest_minutes     integer,
  updated_at       timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (tenant_id, person_id, date),
  FOREIGN KEY (tenant_id, person_id) REFERENCES timeoff.member (tenant_id, person_id),
  CONSTRAINT attendance_day_status_known CHECK (status IN ('complete', 'live', 'open'))
);

-- A period's report across the company: every member's days in a range.
CREATE INDEX attendance_day_period_idx ON timeoff.attendance_day (tenant_id, date);

ALTER TABLE timeoff.attendance_day ENABLE ROW LEVEL SECURITY;
ALTER TABLE timeoff.attendance_day FORCE  ROW LEVEL SECURITY;
CREATE POLICY attendance_day_tenant_isolation ON timeoff.attendance_day
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- Rewritten whenever its punches change, so the service replaces rows.
GRANT SELECT, INSERT, UPDATE, DELETE ON timeoff.attendance_day TO svc_timeoff;
