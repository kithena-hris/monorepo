-- Employment periods: one person, many employments (PRD §7, §8.1, §8.5, §12;
-- PEO-110).
--
-- A person record outlives an employment, and a rehire is a new employment on
-- the same record rather than a second person: the same identity account, the
-- same history, the same DSAR subject. Each employment is a period here —
-- when it started, where (the legal entity it was in), when and why it ended,
-- whether HR would take the person back, and, when HR rehired somebody marked
-- not eligible, the reason they gave.
--
-- **A projection, like `people.person`.** The dated truth stays in
-- `person_attribute_history`: each period's start is a `hire_date` row and its
-- end a `last_working_day` row, and a rehire writes a null `last_working_day`
-- row from its start so an "as of" read inside the new period has no end date.
-- This table is what a question about periods reads — may this person be
-- rehired, when did their latest employment end, list their employments —
-- without replaying history. The current period's dates are the person row's
-- `hire_date` and `last_working_day`; the repository writes both together.
--
-- `notice_from` is the status notice was given from, `active` or `on_leave`,
-- so withdrawing notice (PEO-111) returns the person to it.
--
-- **Backfill.** Every person with a hire date gets period 1, from the columns
-- that describe it today. A person on notice before this migration is recorded
-- as having given it from `active`, the common case; a leaver's reason and
-- eligibility were only ever on `people.person.terminated` and stay unknown
-- (null), which a rehire reads as "not refused". The application also treats a
-- hired person with no row as period 1, so a row the backfill could not see is
-- written on that person's next lifecycle move rather than lost.
--
-- Expand only: a new table and an INSERT into it. RLS as in the header of
-- 20260922140000_people_bootstrap.sql.

CREATE TABLE people.employment_period (
  tenant_id              uuid     NOT NULL,
  person_id              uuid     NOT NULL,
  period                 smallint NOT NULL,
  legal_entity_id        uuid,
  started_on             date     NOT NULL,
  last_working_day       date,
  leaving_reason         text,
  eligible_for_rehire    boolean,
  notice_from            text,
  rehire_override_reason text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (tenant_id, person_id, period),
  CONSTRAINT employment_period_positive CHECK (period >= 1),
  CONSTRAINT employment_period_leaving_reason_known
    CHECK (leaving_reason IN ('resigned', 'dismissed', 'end_of_contract')),
  CONSTRAINT employment_period_notice_from_known CHECK (notice_from IN ('active', 'on_leave')),
  CONSTRAINT employment_period_override_length CHECK (char_length(rehire_override_reason) <= 500)
);

CREATE TRIGGER employment_period_touch_updated_at
  BEFORE UPDATE ON people.employment_period
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

ALTER TABLE people.employment_period ENABLE ROW LEVEL SECURITY;
ALTER TABLE people.employment_period FORCE  ROW LEVEL SECURITY;
CREATE POLICY employment_period_tenant_isolation ON people.employment_period
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE ON people.employment_period TO svc_people;

INSERT INTO people.employment_period
  (tenant_id, person_id, period, legal_entity_id, started_on, last_working_day, notice_from)
SELECT tenant_id, id, 1, legal_entity_id, hire_date, last_working_day,
       CASE WHEN status = 'notice' THEN 'active' END
  FROM people.person
 WHERE hire_date IS NOT NULL
ON CONFLICT DO NOTHING;
