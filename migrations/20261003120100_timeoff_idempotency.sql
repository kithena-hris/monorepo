-- A REST write's Idempotency-Key (TOF-046), written in the write's own
-- transaction, so the write and the record of it commit together or not at
-- all — People's `people.idempotency_key`, with the answer kept rather than
-- a resource id: a Time Off answer is a status or an id, never somebody's
-- record. A retry with the same key and request is answered from here; the
-- same key with a different request is refused.
--
-- ponytail: rows are never pruned. Add a sweep past the 24 hours integrators
-- are told about when the table is big enough to notice.

CREATE TABLE timeoff.idempotency_key (
  tenant_id     uuid        NOT NULL,
  key           text        NOT NULL,
  request_hash  char(64)    NOT NULL,
  status        smallint    NOT NULL,
  answer        jsonb       NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (tenant_id, key),
  CONSTRAINT idempotency_key_length CHECK (length(key) BETWEEN 1 AND 255)
);

ALTER TABLE timeoff.idempotency_key ENABLE ROW LEVEL SECURITY;
ALTER TABLE timeoff.idempotency_key FORCE  ROW LEVEL SECURITY;
CREATE POLICY idempotency_key_tenant_isolation ON timeoff.idempotency_key
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- Written once and read back; never changed.
GRANT SELECT, INSERT ON timeoff.idempotency_key TO svc_timeoff;
