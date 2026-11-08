-- Each member's kept days summed by month (Insights): the missed clock-outs and
-- the overtime of complete days. Six months of a company of thousands was half
-- a million days summed on every visit, a second of the page; summed here, it
-- is a row per member and month.
--
-- Derived from `attendance_day`, as that is from the punches: whenever a
-- member's days are kept again, the months they fall in are summed again in
-- the same transaction. A month still under way is read from its days, so a
-- shift nobody has clocked out of yet never counts here.
CREATE TABLE timeoff.attendance_month (
  tenant_id         uuid NOT NULL,
  person_id         uuid NOT NULL,
  -- Its first day.
  month             date NOT NULL,
  missed_clock_outs integer NOT NULL,
  overtime_minutes  integer NOT NULL,

  PRIMARY KEY (tenant_id, person_id, month),
  FOREIGN KEY (tenant_id, person_id) REFERENCES timeoff.member (tenant_id, person_id),
  CONSTRAINT attendance_month_first_day CHECK (extract(day FROM month) = 1)
);

-- A range of months across the company.
CREATE INDEX attendance_month_period_idx ON timeoff.attendance_month (tenant_id, month);

ALTER TABLE timeoff.attendance_month ENABLE ROW LEVEL SECURITY;
ALTER TABLE timeoff.attendance_month FORCE  ROW LEVEL SECURITY;
CREATE POLICY attendance_month_tenant_isolation ON timeoff.attendance_month
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- Summed again whenever its days are kept again.
GRANT SELECT, INSERT, UPDATE, DELETE ON timeoff.attendance_month TO svc_timeoff;

-- The months already kept.
INSERT INTO timeoff.attendance_month
  (tenant_id, person_id, month, missed_clock_outs, overtime_minutes)
SELECT tenant_id, person_id, date_trunc('month', date)::date,
       count(*) FILTER (WHERE status = 'open'),
       coalesce(sum(overtime_minutes) FILTER (WHERE status = 'complete'), 0)
FROM timeoff.attendance_day
GROUP BY 1, 2, 3;
