-- Asking somebody for an empty detail of theirs (the profile's request
-- button): one row per person and field, the latest ask. The profile says a
-- field was asked for, and the person sees what they were asked for until
-- they fill it in. Filling it in needs no clearing: a request for a field
-- that has a value is not shown.
--
-- `requested_at` is also the email's cap: another ask within a day updates
-- nothing and sends nothing.

CREATE TABLE people.detail_request (
  tenant_id     uuid        NOT NULL,
  person_id     uuid        NOT NULL,
  attribute_key text        NOT NULL,
  -- The account that asked: HR, or a manager.
  requested_by  uuid        NOT NULL,
  requested_at  timestamptz NOT NULL,

  PRIMARY KEY (tenant_id, person_id, attribute_key),
  FOREIGN KEY (tenant_id, person_id) REFERENCES people.person (tenant_id, id) ON DELETE CASCADE
);

-- The isolation form from 20260922140000_people_bootstrap.sql, unchanged.
ALTER TABLE people.detail_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE people.detail_request FORCE  ROW LEVEL SECURITY;
CREATE POLICY detail_request_tenant_isolation ON people.detail_request
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON people.detail_request TO svc_people;
