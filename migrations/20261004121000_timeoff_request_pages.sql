-- The approver's Coming up and Decided, a keyset page at a time as the list
-- scrolls (`drizzle-leave.ts`, `page`): Decided newest asked first, Coming up
-- by first day. Before this every look read the company's decided requests,
-- ever, and sorted them in memory.
--
-- Expand only: two indexes, nothing read or written differently.
CREATE INDEX request_page_newest
  ON timeoff.request (tenant_id, requested_at DESC, id DESC);
CREATE INDEX request_page_soonest
  ON timeoff.request (tenant_id, (lower(range_merge(days))), id)
  WHERE status = 'approved';
