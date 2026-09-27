-- Slack: which workspace belongs to which company, and that workspace's bot
-- token, for the Slack service (platform/slack). Slack is one chat app of
-- possibly several; which notices go to chat apps is each module's own
-- setting (people.chat_notice), not this service's.
--
-- ### Why a schema and a role of its own
--
-- The same rule messaging follows: `svc_slack` can see this and nothing
-- else. The Slack service holds a third party's tokens and talks to the
-- public internet; it reads no module's data, and asks People over HTTP.
--
-- ### The token
--
-- Encrypted by the service before it is written (AES-256-GCM, a key the
-- database never sees), so a backup or a support query yields nothing
-- usable. `token_key_id` names the key, so it can be rotated.
--
-- ### Finding the company for a workspace
--
-- Slack's messages carry a workspace id and nothing about a company, so the
-- service has to ask which company a workspace is before it knows whose
-- rows to read. Row-level security keys every read on the company, as
-- everywhere else; `slack.company_of_workspace` is the one question asked
-- without it, and answers the company id alone.

CREATE SCHEMA IF NOT EXISTS slack;

CREATE TABLE slack.installation (
  tenant_id        uuid        PRIMARY KEY,
  -- Slack's workspace id (T…): one workspace, one company.
  team_id          text        NOT NULL UNIQUE,
  team_name        text        NOT NULL,
  bot_user_id      text        NOT NULL,
  bot_token        bytea       NOT NULL,
  token_key_id     text        NOT NULL,
  -- The Kithena account that connected it.
  installed_by     uuid,
  installed_at     timestamptz NOT NULL,

  CONSTRAINT installation_team_id_shape CHECK (team_id ~ '^[TE][A-Z0-9]{2,20}$'),
  CONSTRAINT installation_team_name_length CHECK (length(team_name) BETWEEN 1 AND 200)
);

ALTER TABLE slack.installation ENABLE ROW LEVEL SECURITY;
ALTER TABLE slack.installation FORCE  ROW LEVEL SECURITY;
CREATE POLICY installation_tenant_isolation ON slack.installation
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

GRANT USAGE ON SCHEMA slack TO svc_slack;
GRANT SELECT, INSERT, UPDATE, DELETE ON slack.installation TO svc_slack;

-- The company a workspace belongs to, and nothing else: the one read made
-- before the company is known. SECURITY DEFINER, owned by the migrating
-- role, with its search path pinned.
CREATE FUNCTION slack.company_of_workspace(workspace text) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, slack
AS $$ SELECT tenant_id FROM slack.installation WHERE team_id = workspace $$;

REVOKE ALL ON FUNCTION slack.company_of_workspace(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION slack.company_of_workspace(text) TO svc_slack;
