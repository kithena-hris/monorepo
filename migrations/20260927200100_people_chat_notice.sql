-- Which of People's notices also go to the company's chat apps (Slack today,
-- others later): a row is one switched on; no row, email only. The chat app
-- is not named — whichever the company connected delivers it.

CREATE TABLE people.chat_notice (
  tenant_id   uuid        NOT NULL,
  event       text        NOT NULL,
  enabled_by  uuid        NOT NULL,
  enabled_at  timestamptz NOT NULL,

  PRIMARY KEY (tenant_id, event),
  CONSTRAINT chat_notice_event_shape CHECK (event ~ '^[a-z][a-z0-9_]{0,63}$')
);

-- The isolation form from 20260922140000_people_bootstrap.sql, unchanged.
ALTER TABLE people.chat_notice ENABLE ROW LEVEL SECURITY;
ALTER TABLE people.chat_notice FORCE  ROW LEVEL SECURITY;
CREATE POLICY chat_notice_tenant_isolation ON people.chat_notice
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, DELETE ON people.chat_notice TO svc_people;
