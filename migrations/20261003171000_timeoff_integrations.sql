-- Calendars and chat apps (PRD §5.3, T35, TOF-109). Expand only: two new tables.

-- ------------------------------------------------------------ integration --
--
-- A company's connection to one provider. `config` is what the provider said
-- about the company (a directory id, a workspace's name) and never a secret;
-- `secret` is sealed by the adapter that made it (AES-256-GCM under
-- TIMEOFF_INTEGRATION_KEY) and is never plaintext here.
CREATE TABLE timeoff.integration (
  tenant_id    uuid NOT NULL,
  provider     text NOT NULL,
  config       jsonb NOT NULL DEFAULT '{}'::jsonb,
  secret       text,
  connected_at timestamptz NOT NULL,
  connected_by uuid NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (tenant_id, provider),
  CONSTRAINT integration_provider_known
    CHECK (provider IN ('google', 'microsoft', 'slack', 'teams')),
  CONSTRAINT integration_config_is_an_object CHECK (jsonb_typeof(config) = 'object')
);

ALTER TABLE timeoff.integration ENABLE ROW LEVEL SECURITY;
ALTER TABLE timeoff.integration FORCE  ROW LEVEL SECURITY;
CREATE POLICY integration_tenant_isolation ON timeoff.integration
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE TRIGGER integration_touch_updated_at
  BEFORE UPDATE ON timeoff.integration
  FOR EACH ROW EXECUTE FUNCTION timeoff.touch_updated_at();

-- ----------------------------------------------------- integration_member --
--
-- A member's own grant where a provider needs one: a chat status is the
-- person's to set, so their token, sealed like the company's. Goes when the
-- company disconnects.
CREATE TABLE timeoff.integration_member (
  tenant_id  uuid NOT NULL,
  provider   text NOT NULL,
  person_id  uuid NOT NULL,
  secret     text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (tenant_id, provider, person_id),
  FOREIGN KEY (tenant_id, provider)
    REFERENCES timeoff.integration (tenant_id, provider) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, person_id) REFERENCES timeoff.member (tenant_id, person_id)
);

ALTER TABLE timeoff.integration_member ENABLE ROW LEVEL SECURITY;
ALTER TABLE timeoff.integration_member FORCE  ROW LEVEL SECURITY;
CREATE POLICY integration_member_tenant_isolation ON timeoff.integration_member
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON timeoff.integration        TO svc_timeoff;
GRANT SELECT, INSERT, UPDATE, DELETE ON timeoff.integration_member TO svc_timeoff;
