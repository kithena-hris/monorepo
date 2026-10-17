-- The Performance module's schema and the role that reaches it (PRF-002).
--
-- A copy of `20260922140000_people_bootstrap.sql`, for its reasons. Every
-- `performance` table carries the isolation form set out there:
--
--     ALTER TABLE performance.<t> ENABLE ROW LEVEL SECURITY;
--     ALTER TABLE performance.<t> FORCE  ROW LEVEL SECURITY;
--     CREATE POLICY <t>_tenant_isolation ON performance.<t>
--       USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
--       WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE SCHEMA IF NOT EXISTS performance;

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'svc_performance') THEN
    -- NOBYPASSRLS spelled out: a role that ignores the tenant policy reads
    -- every company's reviews whatever the policy says.
    CREATE ROLE svc_performance NOLOGIN NOBYPASSRLS;
  END IF;
END $$;

GRANT USAGE ON SCHEMA performance TO svc_performance;

COMMENT ON SCHEMA performance IS
  'Performance module. Every table: ENABLE + FORCE row level security, policy on '
  'tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid, '
  'USING and WITH CHECK. See 20260922140000_people_bootstrap.sql.';
