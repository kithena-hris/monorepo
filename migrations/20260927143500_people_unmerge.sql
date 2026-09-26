-- Undoing a merge (PEO-074 follow-up; PRD §12.4).
--
-- A merge is additive, so undoing one needs to know exactly what it moved:
-- which history rows it wrote on the survivor, and which account it handed
-- over. `moved` records that on the merge's decision row from now on — row
-- ids and an account id, never a value. A merge recorded before this has
-- none, and its undo is refused rather than guessed at.
--
-- The undo is a decision of its own, appended like every other: `unmerged`,
-- naming the merge it `reverses` and HR's `reason`, with `attributes_taken`
-- holding the keys it corrected back and `moved` the keys it kept. The pair
-- is offered for review again because its latest decision is an undo.
--
-- Expand only: nullable columns and wider CHECKs.

ALTER TABLE people.duplicate_decision
  ADD COLUMN moved    jsonb,
  ADD COLUMN reason   text,
  ADD COLUMN reverses uuid;

ALTER TABLE people.duplicate_decision
  ADD CONSTRAINT duplicate_decision_reverses_same_tenant
  FOREIGN KEY (tenant_id, reverses) REFERENCES people.duplicate_decision (tenant_id, id);

ALTER TABLE people.duplicate_decision DROP CONSTRAINT duplicate_decision_known;
ALTER TABLE people.duplicate_decision DROP CONSTRAINT duplicate_decision_merge_whole;
ALTER TABLE people.duplicate_decision
  ADD CONSTRAINT duplicate_decision_known CHECK (decision IN ('not_duplicate', 'merged', 'unmerged')),
  -- A merge or its undo names both sides of the pair, one surviving; a dismissal names neither.
  ADD CONSTRAINT duplicate_decision_merge_whole CHECK (
    CASE
      WHEN decision IN ('merged', 'unmerged') THEN survivor_id IN (person_a, person_b)
                                               AND absorbed_id IN (person_a, person_b)
                                               AND survivor_id <> absorbed_id
      ELSE survivor_id IS NULL AND absorbed_id IS NULL AND cardinality(attributes_taken) = 0
    END
  ),
  -- An undo always says which merge and why; nothing else carries either.
  ADD CONSTRAINT duplicate_decision_undo_whole CHECK (
    (decision = 'unmerged') = (reverses IS NOT NULL AND reason IS NOT NULL AND btrim(reason) <> '')
  );

-- One undo per merge: a retried undo finds the merge already reversed.
CREATE UNIQUE INDEX duplicate_decision_one_undo
  ON people.duplicate_decision (tenant_id, reverses)
  WHERE reverses IS NOT NULL;
