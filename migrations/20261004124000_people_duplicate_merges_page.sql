-- Review's merged records, a keyset page at a time as the list scrolls
-- (`drizzle-duplicates.ts`, `merges`): newest merge first, then by id.
-- `duplicate_decision` had nothing on `decided_at`.
--
-- Expand only: an index, nothing read or written differently.
CREATE INDEX duplicate_decision_merges_page
  ON people.duplicate_decision (tenant_id, decided_at DESC, id DESC)
  WHERE decision = 'merged';
