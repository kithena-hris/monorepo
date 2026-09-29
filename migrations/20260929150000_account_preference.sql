-- A person's own preferences, kept with their account so they follow the
-- person from one device to the next: keyboard shortcuts first.
--
-- One row per account and preference name, the value a JSON object the app
-- that owns the preference reads and validates (the tenant app's
-- `ShortcutPrefs` for `shortcuts`). Identity keeps it and does not interpret
-- it: which keys a person pressed is not identity's business, only whose they
-- are. Settings a company makes live with the module they govern; this is for
-- what one person chooses for themselves.
--
-- Nothing personal about anybody else, and no field values: a preference is
-- how somebody likes the app to behave. Small by construction (16 KB).
--
-- Expand only, per CLAUDE.md: a new table. Idempotent, so applying it over a
-- database where it was created by hand is safe.
CREATE TABLE IF NOT EXISTS platform.account_preference (
  tenant_id  uuid        NOT NULL REFERENCES platform.tenant (id),
  account_id uuid        NOT NULL REFERENCES platform.account (id),
  name       text        NOT NULL,
  value      jsonb       NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, name),
  CONSTRAINT account_preference_name_format CHECK (name ~ '^[a-z][a-z0-9-]{0,63}$'),
  CONSTRAINT account_preference_value_object CHECK (jsonb_typeof(value) = 'object'),
  CONSTRAINT account_preference_value_size CHECK (octet_length(value::text) <= 16384)
);

ALTER TABLE platform.account_preference ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.account_preference FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS account_preference_tenant_isolation ON platform.account_preference;
CREATE POLICY account_preference_tenant_isolation ON platform.account_preference
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON platform.account_preference TO svc_identity;
