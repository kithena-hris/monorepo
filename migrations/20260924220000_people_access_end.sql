-- When a leaver's access ended (PRD §5, §8.1; PEO-109).
--
-- People raises `people.person.access_ended` once per leaving — at the
-- end of the last working day on the person's own calendar, on notice or
-- terminated (HR confirming the termination is not awaited), or at once when
-- HR ends it for a dismissal for cause — and identity suspends the account
-- on it. This column is the "once": the instant the event said, written in
-- the transaction that raised it, so a re-run of the hourly job or a second
-- replica finds nobody left to end.
--
-- Null for everybody whose access has not ended, which is every row written
-- before this migration. No backfill: a leaver whose day ended before this landed
-- is picked up by the first run, and ends from the midnight after their last
-- working day, however long ago that was.
--
-- The partial index is the job's question — on notice or terminated, not yet ended, last
-- working day on or before a date — and holds only leavers still waiting,
-- so it stays about as large as one hour's leavers.
--
-- Expand only: a nullable column and an index. `people.person` already
-- carries ENABLE + FORCE row-level security and `person_tenant_isolation`
-- (20260922170000), and `svc_people` already holds SELECT and UPDATE on the
-- table, which covers a new column.

ALTER TABLE people.person
  ADD COLUMN IF NOT EXISTS access_ended_at timestamptz;

COMMENT ON COLUMN people.person.access_ended_at IS
  'When access ended with the current employment; people.person.access_ended carries the same instant. Null: not ended.';

CREATE INDEX IF NOT EXISTS person_access_due_idx
  ON people.person (tenant_id, last_working_day)
  WHERE status IN ('notice', 'terminated') AND access_ended_at IS NULL;
