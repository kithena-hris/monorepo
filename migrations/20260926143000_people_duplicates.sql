-- Duplicate detection and merge (PEO-074; PRD §12.4).
--
-- A merge is always a human decision, and it is additive: both histories
-- survive where they were written, and the absorbed record becomes a tombstone
-- pointing at the survivor. Nothing here deletes anything.
--
-- ### The tombstone
--
-- `merged` is a status, and `merged_into` is the survivor it points at. One
-- without the other is a record that is either gone with no forwarding
-- address or live with one, so the pair is a constraint rather than a habit.
-- Only a record that was never hired is absorbed (the domain's rule: an
-- employment period is payroll history), so no employment period ever belongs
-- to a tombstone. Expand only: a nullable column and a wider CHECK.

ALTER TABLE people.person ADD COLUMN merged_into uuid;

ALTER TABLE people.person
  ADD CONSTRAINT person_merged_into_same_tenant
  FOREIGN KEY (tenant_id, merged_into) REFERENCES people.person (tenant_id, id);

ALTER TABLE people.person DROP CONSTRAINT person_status_known;
ALTER TABLE people.person
  ADD CONSTRAINT person_status_known CHECK (
    status IN ('provisional', 'pre_hire', 'active', 'on_leave', 'notice', 'terminated', 'discarded', 'merged')
  ),
  ADD CONSTRAINT person_merged_points_at_survivor CHECK ((status = 'merged') = (merged_into IS NOT NULL)),
  ADD CONSTRAINT person_not_merged_into_itself CHECK (merged_into IS NULL OR merged_into <> id);

-- ### The decisions
--
-- Every pair a reviewer decided: `not_duplicate`, so the queue stops offering
-- it, or `merged`, with who survived and which keys were taken — names, never
-- values; the values are the survivor's history rows. Append-only: a decision
-- is the audit trail, so there is no UPDATE or DELETE grant. The pair is
-- stored lower id first, so it has one spelling.

CREATE TABLE people.duplicate_decision (
  tenant_id         uuid NOT NULL,
  id                uuid NOT NULL,
  person_a          uuid NOT NULL,
  person_b          uuid NOT NULL,
  decision          text NOT NULL,
  survivor_id       uuid,
  absorbed_id       uuid,
  attributes_taken  text[] NOT NULL DEFAULT '{}',
  decided_by        uuid NOT NULL,
  decided_at        timestamptz NOT NULL,

  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, person_a) REFERENCES people.person (tenant_id, id),
  FOREIGN KEY (tenant_id, person_b) REFERENCES people.person (tenant_id, id),
  CONSTRAINT duplicate_decision_pair_ordered CHECK (person_a < person_b),
  CONSTRAINT duplicate_decision_known CHECK (decision IN ('not_duplicate', 'merged')),
  -- A merge names both sides of the pair, one surviving; a dismissal names neither.
  CONSTRAINT duplicate_decision_merge_whole CHECK (
    CASE decision
      WHEN 'merged' THEN survivor_id IN (person_a, person_b)
                     AND absorbed_id IN (person_a, person_b)
                     AND survivor_id <> absorbed_id
      ELSE survivor_id IS NULL AND absorbed_id IS NULL AND cardinality(attributes_taken) = 0
    END
  )
);

-- One dismissal per pair, so a retried "not a duplicate" is a no-op. A merge
-- needs no index of its own: its absorbed record is a tombstone, and the
-- domain refuses a tombstone a second time.
CREATE UNIQUE INDEX duplicate_decision_one_dismissal
  ON people.duplicate_decision (tenant_id, person_a, person_b)
  WHERE decision = 'not_duplicate';

-- The isolation form from 20260922140000_people_bootstrap.sql, unchanged.
ALTER TABLE people.duplicate_decision ENABLE ROW LEVEL SECURITY;
ALTER TABLE people.duplicate_decision FORCE  ROW LEVEL SECURITY;
CREATE POLICY duplicate_decision_tenant_isolation ON people.duplicate_decision
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT ON people.duplicate_decision TO svc_people;
