-- Review's decision queues, a keyset page at a time as the list scrolls, and
-- counted over every item rather than read off a page.
--
-- Each queue pages newest first on (when it was made, id): `pending-store.ts`
-- `open`, `drizzle-identifier-reviews.ts` `pending` and `share-store.ts`
-- `waiting`, each with `newest`. The indexes they had were on the time alone,
-- which cannot serve the tie on id a keyset needs. Full-value requests page on
-- their UUIDv7 id, which the primary key already orders.
--
-- The counts (`count`, `waitingCount`) filter on who asked: a requester's own
-- changes and requests, and everybody's but the viewer's.
--
-- Expand only: indexes, nothing read or written differently.
CREATE INDEX pending_change_open_page
  ON people.pending_change (tenant_id, requested_at DESC, id DESC)
  WHERE state = 'pending';

CREATE INDEX pending_change_open_by_requester
  ON people.pending_change (tenant_id, requested_by)
  WHERE state = 'pending';

CREATE INDEX identifier_review_pending_page
  ON people.identifier_review (tenant_id, created_at DESC, id DESC)
  WHERE state = 'pending';

CREATE INDEX export_share_waiting_page
  ON people.export_share (tenant_id, requested_at DESC, id DESC)
  WHERE state = 'pending';

CREATE INDEX full_values_request_pending
  ON people.full_values_request (tenant_id, requested_by)
  WHERE state = 'pending';
