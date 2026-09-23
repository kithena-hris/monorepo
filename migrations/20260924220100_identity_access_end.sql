-- Access ends with employment, and comes back with a rehire (PRD §5, §8.1;
-- PEO-109, PEO-110).
--
-- People decides when: `people.person.access_ended` at the end of a leaver's
-- last working day on their own calendar (or at once, for a dismissal for
-- cause), and `people.person.access_restored` when a rehire starts (PEO-110,
-- which reads `access_ended_from` below; this migration serves both). Identity
-- suspends and reinstates the account on them. Suspended, never terminated:
-- the row, its identity and its passkeys stay, so a rehire signs in with the
-- passkey they already have.
--
-- `people_access_at` — the `occurredAt` of the last access event applied.
--   The consumer claims it with a conditional UPDATE and applies an event only
--   when it is newer, the same guard `people_facts_at` (20260923170000) is for
--   the cached name and start date: a replayed or redelivered event is a no-op,
--   and an old `access_ended` published again after a rehire cannot suspend
--   somebody who has come back. Its own column rather than `people_facts_at`,
--   because the two streams are ordered independently and a name correction
--   must not make an access event look stale.
--
-- `access_ended_from` — the status People's suspension took the account out
--   of, so a rehire puts it back where it was: an invited account that never
--   enrolled goes back to invited, not to an active account with no passkey.
--   Null means People has not ended this account's access, which is also how
--   identity tells its own suspensions (an investigation, billing) from
--   People's: a rehire lifts only the latter.
--
-- Null for every existing row, and permanently in a tenant without the People
-- module, which never publishes either event.
--
-- Expand only: two nullable columns and a CHECK every existing row satisfies.
-- `platform.account` already carries ENABLE + FORCE row-level security and its
-- tenant policy (20260821230000); `svc_identity` holds table-level UPDATE on
-- `platform` through the default privileges in `tools/scripts/init-db.sql`,
-- which covers a new column.

ALTER TABLE platform.account
  ADD COLUMN IF NOT EXISTS people_access_at timestamptz,
  ADD COLUMN IF NOT EXISTS access_ended_from text;

ALTER TABLE platform.account
  ADD CONSTRAINT account_access_ended_from_known
  CHECK (access_ended_from IN ('provisioned', 'invited', 'active'));

COMMENT ON COLUMN platform.account.people_access_at IS
  'occurredAt of the last People access event applied (access_ended / access_restored). Null: never.';
COMMENT ON COLUMN platform.account.access_ended_from IS
  'The status People''s end of employment suspended this account from; a rehire restores it. Null: not suspended by People.';
