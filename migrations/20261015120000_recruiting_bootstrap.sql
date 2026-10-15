-- The Recruiting module's schemas and the roles that reach them (REC-002).
--
-- A copy of `20260922140000_people_bootstrap.sql`, for the same reasons, and
-- that file's comments are the pattern's home. Every `recruiting` table
-- carries the isolation form set out there:
--
--     ALTER TABLE recruiting.<t> ENABLE ROW LEVEL SECURITY;
--     ALTER TABLE recruiting.<t> FORCE  ROW LEVEL SECURITY;
--     CREATE POLICY <t>_tenant_isolation ON recruiting.<t>
--       USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
--       WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--
-- `recruiting_public` is the one schema in Kithena without that policy, on
-- purpose (Recruiting PRD §31.2): Kithena Jobs searches published ads across
-- companies, which tenant isolation forbids by design. It holds only what is
-- already public on a job page, is written only by Recruiting, and is read by
-- `svc_jobs_reader`, which can read nothing else.

CREATE SCHEMA IF NOT EXISTS recruiting;
CREATE SCHEMA IF NOT EXISTS recruiting_public;

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'svc_recruiting') THEN
    -- NOBYPASSRLS spelled out: a role that ignores the tenant policy reads
    -- every company's candidates whatever the policy says. Not altered when it
    -- exists, for the reason the People bootstrap gives.
    CREATE ROLE svc_recruiting NOLOGIN NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'svc_jobs_reader') THEN
    CREATE ROLE svc_jobs_reader NOLOGIN NOBYPASSRLS;
  END IF;
END $$;

-- Table privileges arrive with the tables, as in People.
GRANT USAGE ON SCHEMA recruiting TO svc_recruiting;
GRANT USAGE ON SCHEMA recruiting_public TO svc_recruiting, svc_jobs_reader;

COMMENT ON SCHEMA recruiting IS
  'Recruiting module. Every table: ENABLE + FORCE row level security, policy on '
  'tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid, '
  'USING and WITH CHECK. See 20260922140000_people_bootstrap.sql.';
COMMENT ON SCHEMA recruiting_public IS
  'Published job ads only, readable across companies by svc_jobs_reader. Every '
  'column is classified public; written only by svc_recruiting. Recruiting PRD §31.2.';
