-- A team task taken (Inbox H1, Z3): some tasks go to a role rather than a
-- person, such as an integration failing for every People administrator.
-- Anyone holding the role may take it; the others then see who is on it and
-- it stops counting for them. Taking it over replaces the row, with a note.
--
-- The task itself is People's own row (the failing endpoint); this keeps only
-- who took it, by the Inbox item's id, so it outlives no task: a claim on an
-- item no longer shown is never read.
--
-- Expand only: one new table.

CREATE TABLE people.inbox_claim (
  tenant_id  uuid        NOT NULL,
  item_id    text        NOT NULL,
  taken_by   uuid        NOT NULL,
  taken_at   timestamptz NOT NULL,
  note       text,

  PRIMARY KEY (tenant_id, item_id),
  CONSTRAINT inbox_claim_item CHECK (length(item_id) BETWEEN 3 AND 200),
  CONSTRAINT inbox_claim_note CHECK (note IS NULL OR length(note) <= 2000)
);

ALTER TABLE people.inbox_claim ENABLE ROW LEVEL SECURITY;
ALTER TABLE people.inbox_claim FORCE  ROW LEVEL SECURITY;
CREATE POLICY inbox_claim_tenant_isolation ON people.inbox_claim
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE ON people.inbox_claim TO svc_people;
