-- Review's Flagged, counted and paged over every change waiting (design AI7).
--
-- `flag_evidence` is what a change's checks found while it waits
-- (`domain/approval/unusual.ts`, `evidenceOf`): each check that fires and its
-- size (a raise's percentage), taken with every check on, no marks, and
-- nobody deciding. Never a sentence, an amount or a name. It is taken when the
-- change is asked for and again hourly while it waits, since what it is
-- compared with (the team's raises, the band, a recent address change) moves.
-- A decider's switches, marks and what they may read are applied when the
-- tab is read (`pending-store.ts`, `flaggedSql`), so turning a check off or
-- marking a change "Not unusual" needs nothing rewritten. Null until first
-- taken.
--
-- Expand only: a nullable column and an index, no backfill (the hourly pass
-- takes every change waiting).
ALTER TABLE people.pending_change ADD COLUMN flag_evidence jsonb;

-- The Flagged tab, newest first: only changes that something flagged.
CREATE INDEX pending_change_flagged_page
  ON people.pending_change (tenant_id, requested_at DESC, id DESC)
  WHERE state = 'pending' AND jsonb_array_length(flag_evidence) > 0;
