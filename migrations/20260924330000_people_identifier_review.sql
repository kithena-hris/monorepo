-- National identifiers waiting for, or given, HR's review (PEO-125).
--
-- A national identifier is judged against its country's strictest published
-- rule on every write, and nothing but a value that cannot be the identifier
-- at all is refused. A value accepted with an `attention` or `mismatch`
-- finding — a NIF whose control letter does not compute, a company's PAN — is
-- a row here, and HR's reviewer decides it: `accepted` is final and the value
-- is never flagged again, `sent_back` asks the employee to correct it.
--
-- ### History-safe
--
-- A review points at the history row that wrote the value (`history_id`) and
-- never changes it: history is append-only, and a decision about a value is a
-- fact about the review, not a correction of the value. A new write of the
-- attribute supersedes the open review instead of editing it.
--
-- ### Never the value
--
-- The findings are codes, levels and messages, none of which repeats the
-- identifier (`national-id.ts` guarantees it and a unit test holds it). The
-- value itself stays sealed in `people.person_secret`; a reviewer who must see
-- it goes through the audited reveal.

CREATE TABLE people.identifier_review (
  tenant_id      uuid NOT NULL,
  id             uuid NOT NULL,
  person_id      uuid NOT NULL,
  attribute_key  text NOT NULL,
  -- The write under review. Its row in history is never touched.
  history_id     uuid NOT NULL,
  -- `[{ level, code, message }]`: what the check found. Never the value.
  findings       jsonb NOT NULL,
  state          text NOT NULL DEFAULT 'pending',
  created_at     timestamptz NOT NULL,
  decided_by     uuid,
  decided_at     timestamptz,
  note           text,

  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, person_id) REFERENCES people.person (tenant_id, id),
  FOREIGN KEY (history_id) REFERENCES people.person_attribute_history (id),
  CONSTRAINT identifier_review_state CHECK (state IN ('pending', 'accepted', 'sent_back', 'superseded')),
  CONSTRAINT identifier_review_findings_list CHECK (jsonb_typeof(findings) = 'array'),
  CONSTRAINT identifier_review_note_bounded CHECK (note IS NULL OR length(note) <= 500),
  -- A decision is whole: who and when, or neither. A decided review has one
  -- and a pending one has none; a superseded one keeps whatever it had, so a
  -- value sent back and then corrected still says who sent it back.
  CONSTRAINT identifier_review_decided_whole CHECK ((decided_by IS NULL) = (decided_at IS NULL)),
  CONSTRAINT identifier_review_decided_when_decided CHECK (
    CASE state
      WHEN 'pending' THEN decided_by IS NULL
      WHEN 'superseded' THEN true
      ELSE decided_by IS NOT NULL
    END
  )
);

-- One open review per person and attribute: a second write supersedes the
-- first, and two concurrent writes race on this rather than both opening one.
CREATE UNIQUE INDEX identifier_review_one_open
  ON people.identifier_review (tenant_id, person_id, attribute_key)
  WHERE state IN ('pending', 'sent_back');

-- HR's queue and grid: the pending ones, in the order they arrived.
CREATE INDEX identifier_review_pending_idx
  ON people.identifier_review (tenant_id, created_at)
  WHERE state = 'pending';

-- The isolation form from 20260922140000_people_bootstrap.sql, unchanged.
ALTER TABLE people.identifier_review ENABLE ROW LEVEL SECURITY;
ALTER TABLE people.identifier_review FORCE  ROW LEVEL SECURITY;
CREATE POLICY identifier_review_tenant_isolation ON people.identifier_review
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- No DELETE: a review and its decision are the audit trail.
GRANT SELECT, INSERT, UPDATE ON people.identifier_review TO svc_people;
