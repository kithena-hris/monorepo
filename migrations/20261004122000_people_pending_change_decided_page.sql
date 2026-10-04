-- Review's Decided, a keyset page at a time as it scrolls (`pending-store.ts`,
-- `decided`): newest first by when each was decided or lapsed, then by id.
-- `pending_change_decided` is on `decided_at` alone, which cannot serve an
-- order on `COALESCE(decided_at, expires_at)`.
--
-- Expand only: an index, nothing read or written differently.
CREATE INDEX pending_change_decided_page
  ON people.pending_change (tenant_id, (COALESCE(decided_at, expires_at)) DESC, id DESC);
