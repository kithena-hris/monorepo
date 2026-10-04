-- The delivery log's keyset (`infrastructure/webhooks/list.ts`): one
-- endpoint's deliveries, newest first by `seq`, fifty at a time as the log
-- scrolls. The existing indexes are partial on `status = 'pending'`, so every
-- page sorted the endpoint's whole history.
--
-- Expand only: an index, nothing read or written differently.
CREATE INDEX webhook_delivery_log
  ON people.webhook_delivery (tenant_id, endpoint_id, seq DESC);
