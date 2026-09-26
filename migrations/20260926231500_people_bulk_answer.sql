-- ------------------------------------------------------------- bulk_answer --
--
-- A bulk write's first answer (bulk hire), kept so a retry with the same
-- Idempotency-Key is answered with what the first request did rather than
-- with what stands after it: those it hired would otherwise read as already
-- employed. Its id is the resource `people.idempotency_key` stores.
--
-- Per person: the outcome, the start date, the status and placement it landed
-- on, and a refusal's reason. Never a name: a replay reads those again,
-- through the same authorization as any other read.
--
-- Expand-only: a new table nothing else reads.
--
-- ponytail: rows are never pruned, as idempotency keys are not. Add a
-- retention sweep for both together.
CREATE TABLE people.bulk_answer (
  tenant_id  uuid        NOT NULL,
  id         uuid        NOT NULL,
  answer     jsonb       NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);

ALTER TABLE people.bulk_answer ENABLE ROW LEVEL SECURITY;
ALTER TABLE people.bulk_answer FORCE  ROW LEVEL SECURITY;
CREATE POLICY bulk_answer_tenant_isolation ON people.bulk_answer
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT ON people.bulk_answer TO svc_people;
