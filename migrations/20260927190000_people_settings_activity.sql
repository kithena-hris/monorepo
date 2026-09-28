-- Every change to People's settings, as the Settings activity log shows it:
-- who, when, what in words, and what it was done to. Recorded by the router
-- when a settings command succeeds, whichever transport asked (GraphQL calls
-- REST); a retry of the same command, same Idempotency-Key, is one entry.
--
-- Words and names only: no body, no secret, no value somebody entered.

CREATE TABLE people.settings_activity (
  tenant_id       uuid        NOT NULL,
  id              uuid        NOT NULL,
  at              timestamptz NOT NULL,
  -- The account that did it.
  actor           uuid        NOT NULL,
  -- "Added a field", "Granted a role".
  action          text        NOT NULL,
  -- What it was done to, in words: a field's label, a location's name.
  subject         text,
  -- Which settings page it belongs to: fields, organisation, roles, integrations.
  area            text        NOT NULL,
  idempotency_key text        NOT NULL,

  PRIMARY KEY (tenant_id, id),
  CONSTRAINT settings_activity_once UNIQUE (tenant_id, idempotency_key),
  CONSTRAINT settings_activity_area
    CHECK (area IN ('fields', 'organisation', 'roles', 'integrations')),
  CONSTRAINT settings_activity_action CHECK (length(action) BETWEEN 1 AND 200),
  CONSTRAINT settings_activity_subject CHECK (subject IS NULL OR length(subject) <= 300)
);

CREATE INDEX settings_activity_recent_idx ON people.settings_activity (tenant_id, at DESC, id DESC);

-- The isolation form from 20260922140000_people_bootstrap.sql, unchanged.
ALTER TABLE people.settings_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE people.settings_activity FORCE  ROW LEVEL SECURITY;
CREATE POLICY settings_activity_tenant_isolation ON people.settings_activity
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- Appended and read; never changed.
GRANT SELECT, INSERT ON people.settings_activity TO svc_people;
