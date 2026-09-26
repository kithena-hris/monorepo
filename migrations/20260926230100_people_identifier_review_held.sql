-- A doubted identifier held for approval is reviewed before it is approved
-- (PEO-077, PEO-125; PRD §8.6).
--
-- Its review points at the held change rather than at a history row, which
-- does not exist until the change is approved. Exactly one of the two. Once
-- approved, the value is written through the ordinary path and meets the
-- review it already has, accepted, so it is not reviewed twice. A review that
-- finds errors declines the change (`pending_change.decided_as`).
--
-- Expand only: a dropped NOT NULL, a nullable column, a CHECK every existing
-- row passes (each has a history row and no change).

ALTER TABLE people.identifier_review ALTER COLUMN history_id DROP NOT NULL;
ALTER TABLE people.identifier_review ADD COLUMN pending_change_id uuid;

ALTER TABLE people.identifier_review
  ADD CONSTRAINT identifier_review_held_change
  FOREIGN KEY (tenant_id, pending_change_id) REFERENCES people.pending_change (tenant_id, id),
  ADD CONSTRAINT identifier_review_of_one CHECK ((history_id IS NULL) <> (pending_change_id IS NULL));

-- A held change's review, found from the change.
CREATE INDEX identifier_review_change_idx
  ON people.identifier_review (tenant_id, pending_change_id)
  WHERE pending_change_id IS NOT NULL;
