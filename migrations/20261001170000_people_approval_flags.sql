-- Flagged approvals (design AI7, AI8; `domain/approval/unusual.ts`).
--
-- Four things People keeps about the checks that flag a change waiting for
-- approval. None of them holds a value from anybody's record.
--
--   * `approval_check`: a People administrator switched a check on or off.
--     No row is the check's default (`CHECKS` in the domain).
--   * `approval_flag_mark`: "Not unusual", said about one reason on one
--     change. For 90 days the same check stays quiet for the same requester —
--     for a raise, only up to `magnitude`, the size that was marked. Marks
--     tune one company's checks only: RLS keeps them in their tenant.
--   * `approval_question`: the decider asked the requester something before
--     deciding ("Ask Nora"); the requester answers once. Bounded text, kept
--     as the audit trail of why a change was approved.
--   * `pending_change.flags`: the checks that flagged a change when it was
--     decided, for "the last 90 days". Null before this, and for a change
--     nobody decided.
--
-- Expand only: three new tables and a nullable column, no backfill.

CREATE TABLE people.approval_check (
  tenant_id  uuid        NOT NULL,
  code       text        NOT NULL,
  enabled    boolean     NOT NULL,
  set_by     uuid        NOT NULL,
  set_at     timestamptz NOT NULL,

  PRIMARY KEY (tenant_id, code),
  CONSTRAINT approval_check_code_shape CHECK (code ~ '^[a-z][a-z0-9_]{0,63}$')
);

CREATE TABLE people.approval_flag_mark (
  tenant_id     uuid        NOT NULL,
  change_id     uuid        NOT NULL,
  code          text        NOT NULL,
  requested_by  uuid        NOT NULL,
  magnitude     numeric(9,2),
  marked_by     uuid        NOT NULL,
  marked_at     timestamptz NOT NULL,

  PRIMARY KEY (tenant_id, change_id, code),
  FOREIGN KEY (tenant_id, change_id) REFERENCES people.pending_change (tenant_id, id),
  CONSTRAINT approval_flag_mark_code_shape CHECK (code ~ '^[a-z][a-z0-9_]{0,63}$')
);

-- The company's recent marks, read on every look at the inbox.
CREATE INDEX approval_flag_mark_recent ON people.approval_flag_mark (tenant_id, marked_at);

CREATE TABLE people.approval_question (
  tenant_id    uuid        NOT NULL,
  id           uuid        NOT NULL,
  change_id    uuid        NOT NULL,
  asked_by     uuid        NOT NULL,
  asked_at     timestamptz NOT NULL,
  question     text        NOT NULL,
  answer       text,
  answered_at  timestamptz,

  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, change_id) REFERENCES people.pending_change (tenant_id, id),
  CONSTRAINT approval_question_bounded CHECK (length(question) BETWEEN 1 AND 500),
  CONSTRAINT approval_answer_bounded CHECK (answer IS NULL OR length(answer) BETWEEN 1 AND 500),
  CONSTRAINT approval_answer_whole CHECK ((answer IS NULL) = (answered_at IS NULL))
);

CREATE INDEX approval_question_change ON people.approval_question (tenant_id, change_id);

ALTER TABLE people.pending_change ADD COLUMN flags text[];

-- Decided changes, newest first, for the Decided tab and the last 90 days.
CREATE INDEX pending_change_decided
  ON people.pending_change (tenant_id, decided_at) WHERE decided_at IS NOT NULL;

-- The isolation form from 20260922140000_people_bootstrap.sql, unchanged.
ALTER TABLE people.approval_check ENABLE ROW LEVEL SECURITY;
ALTER TABLE people.approval_check FORCE  ROW LEVEL SECURITY;
CREATE POLICY approval_check_tenant_isolation ON people.approval_check
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE people.approval_flag_mark ENABLE ROW LEVEL SECURITY;
ALTER TABLE people.approval_flag_mark FORCE  ROW LEVEL SECURITY;
CREATE POLICY approval_flag_mark_tenant_isolation ON people.approval_flag_mark
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE people.approval_question ENABLE ROW LEVEL SECURITY;
ALTER TABLE people.approval_question FORCE  ROW LEVEL SECURITY;
CREATE POLICY approval_question_tenant_isolation ON people.approval_question
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE ON people.approval_check TO svc_people;
GRANT SELECT, INSERT ON people.approval_flag_mark TO svc_people;
GRANT SELECT, INSERT, UPDATE ON people.approval_question TO svc_people;
