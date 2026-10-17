-- Two more kinds of Performance record: a webhook endpoint (PRF-058) and a
-- plan Ask Kithena proposed in a chat app, held until the person confirms it
-- there (PRF-164). Expand only: the list grows.
ALTER TABLE performance.record DROP CONSTRAINT record_kind_check;
ALTER TABLE performance.record ADD CONSTRAINT record_kind_check CHECK (kind IN (
  'template', 'cycle', 'review', 'nomination', 'feedback', 'request', 'note', 'goal', 'item',
  'assignment', 'automation', 'calibration', 'ai', 'grant', 'org_unit', 'chart',
  'webhook', 'chat_plan'
));

-- The webhook sweep reads what the outbox holds after an endpoint's cursor, in order.
CREATE INDEX performance_outbox_order_idx ON performance.outbox (tenant_id, created_at, event_id);
