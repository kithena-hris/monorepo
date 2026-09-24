-- A value dated in the future comes into force on its day (PRD §8.5, §11; PEO-124).
--
-- A write dated ahead is recorded in `person_attribute_history` at once and
-- reaches the projection (`people.person`'s typed columns and `custom`) only
-- when its `effective_from` has begun on the person's own calendar. An hourly,
-- bounded job does that. Two things let it find the work and do it once.
--
-- ### `applied_through`, a watermark on the projection
--
-- The person's day the job last brought their projection up to: every dated
-- value effective on or before it is in the row. History is append-only (a
-- trigger refuses UPDATE; 20260922170000), so "applied" cannot be a mark on
-- the history row — and a watermark is one date per person rather than one
-- per value. It only narrows the candidates: the job itself compares the
-- value in force with the one the row holds, so a rerun, a second replica or
-- a watermark that is a day behind brings nothing in twice.
--
-- Null for every row written before this migration, and for every new one:
-- null reads as "not yet visited", and the candidates are bounded by the
-- index below rather than by the watermark, so nobody is revisited for a
-- value that was in force when it was written.
--
-- ### The scheduled rows, as a partial index
--
-- Only rows dated after the day they were recorded — judged at UTC−12, the
-- earliest date anywhere, since the person's own day is not on the row — ever
-- need the job. `scheduled()` in `domain/person/history.ts` is the same
-- predicate. They are a small share of history, so the index stays small and
-- the job's hourly question is a range scan on it, not a scan of history.
--
-- Expand only: a nullable column, an index and a new table. `people.person` already carries
-- ENABLE + FORCE row-level security and `person_tenant_isolation`, and
-- `person_attribute_history` `history_tenant_isolation` (both 20260922170000,
-- in the form 20260922140000_people_bootstrap.sql sets out); `svc_people`
-- already holds SELECT and UPDATE on `people.person`, which covers a new column.

ALTER TABLE people.person
  ADD COLUMN IF NOT EXISTS applied_through date;

COMMENT ON COLUMN people.person.applied_through IS
  'The person''s day through which every dated value is in the projection (PEO-124). Null: not yet visited.';

CREATE INDEX IF NOT EXISTS person_history_scheduled_idx
  ON people.person_attribute_history (tenant_id, effective_from, person_id)
  WHERE effective_from > (recorded_at AT TIME ZONE 'Etc/GMT+12')::date;

-- ### A scheduled value refused on its day
--
-- A move the domain will not make when its day comes — a transfer for somebody
-- who has since given notice — is recorded here once, by the history row
-- that was refused: the job stops retrying that row, raises
-- `people.person.scheduled_change_refused` the one time the row is written,
-- and HR's grid shows a `scheduled_change_refused` task until a newer row for
-- the same key (a correction carrying `supersedes`, or a replacement value) is
-- recorded. The row is kept as the record that it happened; the task is read
-- off it and the history, never cleared by hand. The key and the refusal's
-- code, never the value. RLS as in the header of
-- 20260922140000_people_bootstrap.sql.

CREATE TABLE IF NOT EXISTS people.scheduled_refusal (
  tenant_id      uuid        NOT NULL,
  history_id     uuid        NOT NULL,
  person_id      uuid        NOT NULL,
  attribute_key  text        NOT NULL,
  reason         text        NOT NULL,
  -- The job's clock, as history's recorded_at is the writer's: the two are compared.
  refused_at     timestamptz NOT NULL,

  PRIMARY KEY (tenant_id, history_id),
  FOREIGN KEY (history_id) REFERENCES people.person_attribute_history (id),
  CONSTRAINT scheduled_refusal_reason_shape CHECK (reason ~ '^[A-Z][A-Z0-9_]*$')
);

CREATE INDEX IF NOT EXISTS scheduled_refusal_person_idx
  ON people.scheduled_refusal (tenant_id, person_id);

ALTER TABLE people.scheduled_refusal ENABLE ROW LEVEL SECURITY;
ALTER TABLE people.scheduled_refusal FORCE  ROW LEVEL SECURITY;
CREATE POLICY scheduled_refusal_tenant_isolation ON people.scheduled_refusal
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT ON people.scheduled_refusal TO svc_people;
