-- The Time Off module's schema and the role that reaches it.
--
-- A copy of `20260922140000_people_bootstrap.sql`, for the same reasons, and
-- that file's comments are the pattern's home: one schema per module, the
-- role created here when it is missing so the migration applies against a
-- database nobody prepared, NOLOGIN and no password because this file is
-- committed. Every Time Off table carries the isolation form set out there:
--
--     ALTER TABLE timeoff.<t> ENABLE ROW LEVEL SECURITY;
--     ALTER TABLE timeoff.<t> FORCE  ROW LEVEL SECURITY;
--     CREATE POLICY <t>_tenant_isolation ON timeoff.<t>
--       USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
--       WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE SCHEMA IF NOT EXISTS timeoff;

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'svc_timeoff') THEN
    -- NOBYPASSRLS spelled out: a role that ignores the tenant policy reads
    -- every customer's sick days whatever the policy says.
    -- Not altered when it exists: changing the attribute needs privileges the
    -- migrator may not hold, and a failed statement here skips every deploy
    -- step after it. `init-db.sql` and `deploy/vm/deploy.sh` create it with
    -- the attribute spelled out.
    CREATE ROLE svc_timeoff NOLOGIN NOBYPASSRLS;
  END IF;
END $$;

-- Table privileges arrive with the tables, as in People.
GRANT USAGE ON SCHEMA timeoff TO svc_timeoff;

COMMENT ON SCHEMA timeoff IS
  'Time Off module. Every table: ENABLE + FORCE row level security, policy on '
  'tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid, '
  'USING and WITH CHECK. See 20260922140000_people_bootstrap.sql.';
