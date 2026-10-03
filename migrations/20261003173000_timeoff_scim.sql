-- SCIM 2.0 member provisioning for a company without People (PRD §18,
-- TOF-114). Expand only: two new tables.

-- ---------------------------------------------------------- scim_connection --
--
-- An identity provider's bearer token. `kts_` and the tenant's id, the
-- connection's id and 32 random bytes, as People's `kps_`: found inside its
-- own tenant's row-level security, and only its SHA-256 kept.
CREATE TABLE timeoff.scim_connection (
  tenant_id  uuid NOT NULL,
  id         uuid NOT NULL,
  token_hash bytea NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,

  PRIMARY KEY (tenant_id, id),
  CONSTRAINT scim_connection_token_hash_key UNIQUE (token_hash),
  CONSTRAINT scim_connection_token_hash_is_sha256 CHECK (octet_length(token_hash) = 32)
);

ALTER TABLE timeoff.scim_connection ENABLE ROW LEVEL SECURITY;
ALTER TABLE timeoff.scim_connection FORCE  ROW LEVEL SECURITY;
CREATE POLICY scim_connection_tenant_isolation ON timeoff.scim_connection
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- ---------------------------------------------------------------- scim_user --
--
-- What an identity provider calls a member: its `userName` (unique in the
-- company, whatever its case) and its own `externalId`. The member's fields
-- live on `member` like any other source's.
CREATE TABLE timeoff.scim_user (
  tenant_id   uuid NOT NULL,
  person_id   uuid NOT NULL,
  user_name   text NOT NULL,
  external_id text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (tenant_id, person_id),
  FOREIGN KEY (tenant_id, person_id) REFERENCES timeoff.member (tenant_id, person_id),
  CONSTRAINT scim_user_user_name_length CHECK (length(user_name) BETWEEN 1 AND 320)
);

CREATE UNIQUE INDEX scim_user_user_name_key
  ON timeoff.scim_user (tenant_id, lower(user_name));

ALTER TABLE timeoff.scim_user ENABLE ROW LEVEL SECURITY;
ALTER TABLE timeoff.scim_user FORCE  ROW LEVEL SECURITY;
CREATE POLICY scim_user_tenant_isolation ON timeoff.scim_user
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE TRIGGER scim_user_touch_updated_at
  BEFORE UPDATE ON timeoff.scim_user
  FOR EACH ROW EXECUTE FUNCTION timeoff.touch_updated_at();

-- A connection is revoked, never deleted; a user is kept when deprovisioned
-- (the member stays, as a leaver).
GRANT SELECT, INSERT, UPDATE ON timeoff.scim_connection TO svc_timeoff;
GRANT SELECT, INSERT, UPDATE ON timeoff.scim_user       TO svc_timeoff;
