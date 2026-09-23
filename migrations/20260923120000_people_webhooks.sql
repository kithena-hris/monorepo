-- People's headless surfaces: REST idempotency keys and outbound webhooks.
--
-- Every table copies the isolation form set out in
-- 20260922140000_people_bootstrap.sql: ENABLE and FORCE row level security,
-- and one policy on tenant_id with both USING and WITH CHECK.

-- --------------------------------------------------------- idempotency_key --
--
-- A REST write's key, the hash of the request it was first used with, and the
-- resource it produced. Never the response body: that would be a copy of
-- somebody's record kept for no reason, and a replay reads the resource again
-- through the same authorization as any other read.
CREATE TABLE people.idempotency_key (
  tenant_id    uuid        NOT NULL,
  key          text        NOT NULL CHECK (length(key) BETWEEN 1 AND 255),
  request_hash char(64)    NOT NULL,
  status       smallint    NOT NULL,
  resource_id  uuid        NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, key)
);

ALTER TABLE people.idempotency_key ENABLE ROW LEVEL SECURITY;
ALTER TABLE people.idempotency_key FORCE  ROW LEVEL SECURITY;
CREATE POLICY idempotency_key_tenant_isolation ON people.idempotency_key
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT ON people.idempotency_key TO svc_people;

-- -------------------------------------------------------- webhook_endpoint --
--
-- Where a tenant wants events sent, which events, and which attributes inside
-- them (§13.3). The signing secret is sealed under the same envelope scheme as
-- `people.person_secret`; the previous one is kept, sealed, until the overlap
-- window a rotation grants has passed, so a receiver can switch keys without
-- dropping a delivery.
CREATE TABLE people.webhook_endpoint (
  id                          uuid        PRIMARY KEY,
  tenant_id                   uuid        NOT NULL,
  url                         text        NOT NULL CHECK (url LIKE 'https://%'),
  events                      text[]      NOT NULL,
  allowlist                   text[]      NOT NULL DEFAULT '{}',
  secret_ciphertext           bytea       NOT NULL,
  secret_key_id               text        NOT NULL,
  previous_secret_ciphertext  bytea,
  previous_secret_key_id      text,
  previous_secret_expires_at  timestamptz,
  disabled_at                 timestamptz,
  disabled_reason             text,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  CHECK ((previous_secret_ciphertext IS NULL) = (previous_secret_expires_at IS NULL))
);

CREATE INDEX webhook_endpoint_tenant_idx ON people.webhook_endpoint (tenant_id);

ALTER TABLE people.webhook_endpoint ENABLE ROW LEVEL SECURITY;
ALTER TABLE people.webhook_endpoint FORCE  ROW LEVEL SECURITY;
CREATE POLICY webhook_endpoint_tenant_isolation ON people.webhook_endpoint
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- -------------------------------------------------------- webhook_delivery --
--
-- One event for one endpoint. The envelope is stored as the outbox holds it —
-- already stripped of everything §10.3 keeps off an event — and filtered
-- against the endpoint's allowlist at the moment it is sent, not here. That is
-- what makes a replay honour the allowlist as it is now rather than as it was.
--
-- `seq` orders deliveries per person: the dispatcher sends only the oldest
-- pending delivery for an (endpoint, aggregate) pair, so one person's changes
-- arrive in the order they committed. Across people there is no order.
CREATE TABLE people.webhook_delivery (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  seq                 bigint      GENERATED ALWAYS AS IDENTITY,
  tenant_id           uuid        NOT NULL,
  endpoint_id         uuid        NOT NULL REFERENCES people.webhook_endpoint (id),
  event_id            uuid        NOT NULL,
  event_name          text        NOT NULL,
  aggregate_id        text        NOT NULL,
  envelope            jsonb       NOT NULL,
  status              text        NOT NULL DEFAULT 'pending'
                                  CHECK (status IN ('pending', 'delivered', 'skipped', 'failed')),
  attempts            integer     NOT NULL DEFAULT 0,
  next_attempt_at     timestamptz NOT NULL DEFAULT now(),
  first_attempted_at  timestamptz,
  last_response       integer,
  delivered_at        timestamptz,
  replay_of           uuid        REFERENCES people.webhook_delivery (id),
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- At least once, not twice by accident: one original delivery per endpoint
-- and event. A replay is a new row that names the one it repeats.
CREATE UNIQUE INDEX webhook_delivery_once
  ON people.webhook_delivery (endpoint_id, event_id) WHERE replay_of IS NULL;
CREATE INDEX webhook_delivery_due
  ON people.webhook_delivery (tenant_id, next_attempt_at) WHERE status = 'pending';
CREATE INDEX webhook_delivery_order
  ON people.webhook_delivery (endpoint_id, aggregate_id, seq) WHERE status = 'pending';

ALTER TABLE people.webhook_delivery ENABLE ROW LEVEL SECURITY;
ALTER TABLE people.webhook_delivery FORCE  ROW LEVEL SECURITY;
CREATE POLICY webhook_delivery_tenant_isolation ON people.webhook_delivery
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- ---------------------------------------------------------------- enqueue --
--
-- A delivery row per subscribed endpoint, written by the same INSERT that
-- writes the outbox row — so it exists if and only if the event does, with no
-- second writer and no consumer to fall behind. SECURITY INVOKER (the default):
-- it runs as whoever wrote the event, under that transaction's tenant.
CREATE FUNCTION people.enqueue_webhook_deliveries() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO people.webhook_delivery
    (tenant_id, endpoint_id, event_id, event_name, aggregate_id, envelope)
  SELECT NEW.tenant_id, e.id, NEW.event_id, NEW.event_name, NEW.aggregate_id, NEW.envelope
    FROM people.webhook_endpoint e
   WHERE e.tenant_id = NEW.tenant_id
     AND e.disabled_at IS NULL
     AND NEW.event_name = ANY (e.events)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER outbox_enqueues_webhooks
  AFTER INSERT ON people.outbox
  FOR EACH ROW EXECUTE FUNCTION people.enqueue_webhook_deliveries();

GRANT SELECT, INSERT, UPDATE ON people.webhook_endpoint TO svc_people;
GRANT SELECT, INSERT, UPDATE ON people.webhook_delivery TO svc_people;
