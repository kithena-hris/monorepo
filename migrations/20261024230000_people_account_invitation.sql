-- A hire's invitation to their company's Kithena (People PRD §8.2, step 8):
-- sent now, or kept for the day HR chose and sent by the background job on
-- that day, on the person's own calendar. Identity holds the account and the
-- link; this keeps only when it goes, when it went and which account it made.
--
-- Expand only: one new table.

CREATE TABLE people.account_invitation (
  tenant_id   uuid        NOT NULL,
  person_id   uuid        NOT NULL,
  send_on     date        NOT NULL,
  sent_at     timestamptz,
  account_id  uuid,
  invited_by  uuid,
  updated_at  timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (tenant_id, person_id),
  FOREIGN KEY (tenant_id, person_id) REFERENCES people.person (tenant_id, id)
);

CREATE INDEX account_invitation_due_idx
  ON people.account_invitation (tenant_id, send_on) WHERE sent_at IS NULL;

ALTER TABLE people.account_invitation ENABLE ROW LEVEL SECURITY;
ALTER TABLE people.account_invitation FORCE  ROW LEVEL SECURITY;
CREATE POLICY account_invitation_tenant_isolation ON people.account_invitation
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE ON people.account_invitation TO svc_people;
