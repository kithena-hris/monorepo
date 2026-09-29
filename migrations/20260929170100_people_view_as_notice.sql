-- Telling an employee that a People administrator viewed the app as them
-- (decided 2026-09-29): one row per view-as session about them, from
-- identity's `identity.view_as.started` and `identity.view_as.ended`. Their
-- inbox shows it once it is over — ended, or its thirty minutes past — so the
-- notice never depends on anybody having noticed the end.
--
-- No reason and nothing the administrator saw: who, when, and whether
-- special-category data was visible. The reason is the activity log's.

CREATE TABLE people.view_as_notice (
  tenant_id          uuid        NOT NULL,
  session_id         uuid        NOT NULL,
  subject_account_id uuid        NOT NULL,
  admin_account_id   uuid        NOT NULL,
  special_category   boolean     NOT NULL,
  started_at         timestamptz NOT NULL,
  expires_at         timestamptz NOT NULL,
  ended_at           timestamptz,

  PRIMARY KEY (tenant_id, session_id),
  CONSTRAINT view_as_notice_thirty_minutes CHECK (
    expires_at > started_at AND expires_at <= started_at + interval '30 minutes'
  )
);

CREATE INDEX view_as_notice_subject_idx
  ON people.view_as_notice (tenant_id, subject_account_id, started_at DESC);

-- The isolation form from 20260922140000_people_bootstrap.sql, unchanged.
ALTER TABLE people.view_as_notice ENABLE ROW LEVEL SECURITY;
ALTER TABLE people.view_as_notice FORCE  ROW LEVEL SECURITY;
CREATE POLICY view_as_notice_tenant_isolation ON people.view_as_notice
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE ON people.view_as_notice TO svc_people;
