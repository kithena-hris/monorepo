-- Slack: each person's own token, for reading what they can see in Slack to
-- help them write reviews and feedback (Performance PRD §22.3, §23.1).
--
-- A user token, never the workspace's: it reads only what that person could
-- read themselves, and only after they turned Slack on in My connected tools
-- and approved it in Slack. Turning it off revokes it at Slack and deletes the
-- row. Sealed by the service before it is written, as the bot token is.
--
-- Kept here, beside the workspace's token, because this service holds the
-- Slack app's secret; Performance asks it to search, and never sees a token.

CREATE TABLE slack.person_token (
  tenant_id      uuid        NOT NULL,
  person_id      uuid        NOT NULL,
  -- Who they are in Slack (U… or W…): whose messages are "theirs".
  slack_user_id  text        NOT NULL,
  token          bytea       NOT NULL,
  token_key_id   text        NOT NULL,
  granted_at     timestamptz NOT NULL,

  PRIMARY KEY (tenant_id, person_id),
  CONSTRAINT person_token_user_shape CHECK (slack_user_id ~ '^[UW][A-Z0-9]{2,20}$')
);

ALTER TABLE slack.person_token ENABLE ROW LEVEL SECURITY;
ALTER TABLE slack.person_token FORCE  ROW LEVEL SECURITY;
CREATE POLICY person_token_tenant_isolation ON slack.person_token
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON slack.person_token TO svc_slack;
