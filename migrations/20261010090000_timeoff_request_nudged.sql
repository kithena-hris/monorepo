-- When the person who asked nudged whoever has their request (Inbox E1, E3):
-- once, after 48 hours. The approver's task shows it; a second nudge is
-- refused. Expand only: a nullable column, nothing to backfill.
ALTER TABLE timeoff.request ADD COLUMN IF NOT EXISTS nudged_at timestamptz;
