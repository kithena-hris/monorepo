-- A Recruiting hire whose pre-start conditions are still open (Recruiting PRD
-- §21.3): "an open condition on the start date blocks the start and tells HR".
-- One row per hire while any condition is open, written from
-- `recruiting.candidate.hired`, removed by `recruiting.prehire.conditions_met`
-- or `recruiting.prehire.cancelled`. The start job passes over anyone held,
-- and HR's Inbox names them once their start date has come.
--
-- Expand only: one new table.

CREATE TABLE people.start_hold (
  tenant_id       uuid        NOT NULL,
  application_id  uuid        NOT NULL,
  person_id       uuid        NOT NULL,
  -- The condition kinds still open, by Recruiting's keys (`right_to_work`, `references`).
  conditions      text[]      NOT NULL,
  offer_id        uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (tenant_id, application_id),
  FOREIGN KEY (tenant_id, person_id) REFERENCES people.person (tenant_id, id)
);

CREATE INDEX start_hold_person_idx ON people.start_hold (tenant_id, person_id);

ALTER TABLE people.start_hold ENABLE ROW LEVEL SECURITY;
ALTER TABLE people.start_hold FORCE  ROW LEVEL SECURITY;
CREATE POLICY start_hold_tenant_isolation ON people.start_hold
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON people.start_hold TO svc_people;
