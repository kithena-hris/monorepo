-- The Onboarding module's schema and the role that reaches it (ONB-001).
--
-- A copy of `20260922140000_people_bootstrap.sql`, for its reasons. Every
-- `onboarding` table carries the isolation form set out there:
--
--     ALTER TABLE onboarding.<t> ENABLE ROW LEVEL SECURITY;
--     ALTER TABLE onboarding.<t> FORCE  ROW LEVEL SECURITY;
--     CREATE POLICY <t>_tenant_isolation ON onboarding.<t>
--       USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
--       WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE SCHEMA IF NOT EXISTS onboarding;

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'svc_onboarding') THEN
    -- NOBYPASSRLS spelled out: a role that ignores the tenant policy reads
    -- every company's new hires whatever the policy says.
    CREATE ROLE svc_onboarding NOLOGIN NOBYPASSRLS;
  END IF;
END $$;

GRANT USAGE ON SCHEMA onboarding TO svc_onboarding;

COMMENT ON SCHEMA onboarding IS
  'Onboarding module. Every table: ENABLE + FORCE row level security, policy on '
  'tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid, '
  'USING and WITH CHECK. See 20260922140000_people_bootstrap.sql.';
