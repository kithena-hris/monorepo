-- SCIM 2.0 provisioning and mirror mode (PEO-072, PEO-073; PRD §13.5, §13.6).
--
-- A connection is one upstream system — the tenant's Okta, Entra or HRIS —
-- with a bearer token and an approved mapping of SCIM paths to attribute
-- keys. The mapping is also the declaration of mirror mode: every attribute
-- it names is owned by that system, on every record it provisions, and every
-- other writer to it there is refused with the system named (§7 rule 1).
--
-- ### Never the token
--
-- `token_hash` is SHA-256 of the whole token. The token carries 256 random
-- bits, so a fast hash is enough: there is nothing to guess, only to look up,
-- and a dump of this table authenticates nobody. The plaintext is shown once,
-- when it is issued. A rotation keeps the previous hash for 24 hours, so the
-- administrator has a day to paste the new one into the provider.
--
-- ### One owner per fact
--
-- `scim_mapping_one_owner` is the rule that makes "the source of record"
-- singular: an attribute is owned by at most one connection in a tenant, and
-- two administrators mapping one field to two systems at once race on it.
--
-- Expand only: new tables, nothing existing changes.

CREATE TABLE people.scim_connection (
  tenant_id             uuid        NOT NULL,
  id                    uuid        NOT NULL,
  -- What the tenant calls it; a refusal says "kept in <system>".
  system                text        NOT NULL,
  token_hash            text        NOT NULL,
  previous_token_hash   text,
  previous_valid_until  timestamptz,
  created_at            timestamptz NOT NULL,
  created_by            uuid        NOT NULL,
  token_rotated_at      timestamptz,
  -- A revoked connection authenticates nobody and owns nothing; the row stays
  -- as the record that it existed, and its links keep the ids it knew.
  revoked_at            timestamptz,
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT scim_connection_system_named CHECK (length(system) BETWEEN 1 AND 80),
  CONSTRAINT scim_connection_previous_whole
    CHECK ((previous_token_hash IS NULL) = (previous_valid_until IS NULL))
);

CREATE TABLE people.scim_mapping (
  tenant_id      uuid NOT NULL,
  connection_id  uuid NOT NULL,
  scim_path      text NOT NULL,
  attribute_key  text NOT NULL,
  PRIMARY KEY (tenant_id, connection_id, scim_path),
  CONSTRAINT scim_mapping_one_owner UNIQUE (tenant_id, attribute_key),
  FOREIGN KEY (tenant_id, connection_id) REFERENCES people.scim_connection (tenant_id, id)
);

-- A person the connection provisions: SCIM's `id` is the person's id.
CREATE TABLE people.scim_link (
  tenant_id      uuid        NOT NULL,
  connection_id  uuid        NOT NULL,
  person_id      uuid        NOT NULL,
  user_name      text        NOT NULL,
  external_id    text,
  -- SCIM's `active`. False is the upstream saying the person is off; whether
  -- their employment ends is HR's decision (§8.1), so nothing else moves.
  active         boolean     NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL,
  updated_at     timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, connection_id, person_id),
  FOREIGN KEY (tenant_id, connection_id) REFERENCES people.scim_connection (tenant_id, id),
  FOREIGN KEY (tenant_id, person_id) REFERENCES people.person (tenant_id, id),
  CONSTRAINT scim_link_user_name_bounded CHECK (length(user_name) BETWEEN 1 AND 320),
  CONSTRAINT scim_link_external_id_bounded CHECK (external_id IS NULL OR length(external_id) <= 256)
);

-- userName is unique per service provider, case-insensitively (RFC 7643 §4.1.1).
CREATE UNIQUE INDEX scim_link_user_name_key
  ON people.scim_link (tenant_id, connection_id, lower(user_name));
CREATE UNIQUE INDEX scim_link_external_id_key
  ON people.scim_link (tenant_id, connection_id, external_id)
  WHERE external_id IS NOT NULL;
-- Mirror enforcement asks, per person, which connections own what.
CREATE INDEX scim_link_person_idx ON people.scim_link (tenant_id, person_id);

-- Groups carry no authorization (PRD §13.5): nothing in People reads them to
-- decide who may see or do anything. They are kept so a provider pushing
-- groups is answered as the RFC says.
CREATE TABLE people.scim_group (
  tenant_id      uuid        NOT NULL,
  id             uuid        NOT NULL,
  connection_id  uuid        NOT NULL,
  display_name   text        NOT NULL,
  external_id    text,
  created_at     timestamptz NOT NULL,
  updated_at     timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, connection_id) REFERENCES people.scim_connection (tenant_id, id),
  CONSTRAINT scim_group_display_name_bounded CHECK (length(display_name) BETWEEN 1 AND 256),
  CONSTRAINT scim_group_external_id_bounded CHECK (external_id IS NULL OR length(external_id) <= 256)
);
CREATE UNIQUE INDEX scim_group_display_name_key
  ON people.scim_group (tenant_id, connection_id, lower(display_name));

CREATE TABLE people.scim_group_member (
  tenant_id  uuid NOT NULL,
  group_id   uuid NOT NULL,
  person_id  uuid NOT NULL,
  PRIMARY KEY (tenant_id, group_id, person_id),
  FOREIGN KEY (tenant_id, group_id) REFERENCES people.scim_group (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, person_id) REFERENCES people.person (tenant_id, id)
);

-- The isolation form from 20260922140000_people_bootstrap.sql, unchanged.
ALTER TABLE people.scim_connection ENABLE ROW LEVEL SECURITY;
ALTER TABLE people.scim_connection FORCE  ROW LEVEL SECURITY;
CREATE POLICY scim_connection_tenant_isolation ON people.scim_connection
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE people.scim_mapping ENABLE ROW LEVEL SECURITY;
ALTER TABLE people.scim_mapping FORCE  ROW LEVEL SECURITY;
CREATE POLICY scim_mapping_tenant_isolation ON people.scim_mapping
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE people.scim_link ENABLE ROW LEVEL SECURITY;
ALTER TABLE people.scim_link FORCE  ROW LEVEL SECURITY;
CREATE POLICY scim_link_tenant_isolation ON people.scim_link
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE people.scim_group ENABLE ROW LEVEL SECURITY;
ALTER TABLE people.scim_group FORCE  ROW LEVEL SECURITY;
CREATE POLICY scim_group_tenant_isolation ON people.scim_group
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE people.scim_group_member ENABLE ROW LEVEL SECURITY;
ALTER TABLE people.scim_group_member FORCE  ROW LEVEL SECURITY;
CREATE POLICY scim_group_member_tenant_isolation ON people.scim_group_member
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- No DELETE on a connection: revoked, never forgotten.
GRANT SELECT, INSERT, UPDATE ON people.scim_connection TO svc_people;
GRANT SELECT, INSERT, DELETE ON people.scim_mapping TO svc_people;
GRANT SELECT, INSERT, UPDATE, DELETE ON people.scim_link TO svc_people;
GRANT SELECT, INSERT, UPDATE, DELETE ON people.scim_group TO svc_people;
GRANT SELECT, INSERT, DELETE ON people.scim_group_member TO svc_people;
