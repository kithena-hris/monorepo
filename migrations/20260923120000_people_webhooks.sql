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
