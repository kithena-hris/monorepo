-- The People module's schema and the role that reaches it.
--
-- Nothing is created here that holds data. Every later People migration adds
-- tables to this schema and copies the isolation pattern set out below, and
-- separating the two means the pattern is reviewed once, on its own, rather
-- than inside whichever migration first needed a table.
--
-- ### Why a schema of its own
--
-- One schema per module, which is the rule every module follows. `svc_people`
-- can see this and nothing else, so a cross-schema read fails at the database
-- rather than in review — the same guarantee `.dependency-cruiser.cjs` gives at
-- build time, enforced again at runtime where a clever query cannot talk its
-- way past it.

CREATE SCHEMA IF NOT EXISTS people;

-- ------------------------------------------------------------------- role --
--
-- Created here if it does not already exist, and that is not tidiness — it is
-- the difference between this migration applying and taking the whole deploy
-- down with it.
--
-- Roles are cluster-level, so `GRANT ... TO svc_people` fails outright against
-- any database where nobody created the role first: the scratch container
-- `migrate lint` replays into, a fresh staging branch, and production on the
-- day this first runs. Atlas reports it as
--
--     Error: executing statement: pq: role "svc_people" does not exist
--
-- and every deploy step after the migration is skipped. `svc_identity` hit
-- exactly this and the identity and web deploys were silently skipped for a
-- day. Creating the role here means the migration is self-sufficient wherever
-- it runs.
--
-- NOLOGIN, and no password. A password in a migration is a credential in the
-- repository, and this file is committed. The operator grants LOGIN with a
-- password out of band — Neon's console for the managed environments,
-- `tools/scripts/init-db.sql` locally, which creates it with LOGIN before any
-- migration runs and so takes the branch below that does nothing.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'svc_people') THEN
    -- NOBYPASSRLS spelled out although it is the default, because it is the
    -- whole point of the role. Every People table carries a tenant policy, and
    -- a role that ignores one reads every customer's employee records whatever
    -- the policy says. Neon's default owner carries BYPASSRLS, which is why
    -- this is never the owner.
    CREATE ROLE svc_people NOLOGIN NOBYPASSRLS;
  END IF;
END $$;

-- ------------------------------------------------------------------ grants --
--
-- The service connects as `svc_people` and can reach this schema and nothing
-- else. Table privileges arrive with the tables: each later migration grants on
-- what it creates, because a grant here would name a table that does not exist.
GRANT USAGE ON SCHEMA people TO svc_people;

-- ------------------------------------------------------- the isolation form --
--
-- Every table in this schema carries the same four lines, and the wording is
-- not interchangeable with anything that looks similar:
--
--     ALTER TABLE people.<t> ENABLE ROW LEVEL SECURITY;
--     ALTER TABLE people.<t> FORCE  ROW LEVEL SECURITY;
--     CREATE POLICY <t>_tenant_isolation ON people.<t>
--       USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
--       WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--
-- FORCE, because a table's owner bypasses its own policies otherwise, and the
-- owner is what runs the migrations and the seeds.
--
-- NULLIF, because `set_config(..., true)` returns to the empty string rather
-- than to unset at the end of a transaction, and `''::uuid` raises 22P02. The
-- obvious form turns every unscoped query into a 500 from a cast instead of a
-- quiet "no rows", which is the difference between a bug that is found and a
-- bug that is filed as flakiness.
--
-- WITH CHECK as well as USING, because reading is only half of isolation:
-- without it a caller can insert a row it will then be unable to see, and the
-- row it wrote belongs to a tenant it does not.
--
-- `true` as the second argument to `current_setting`, because an unset setting
-- must read as "no tenant" rather than raising — an unscoped connection sees
-- nothing, which is the behaviour a background job or a mistaken pool checkout
-- should get.
--
-- This comment is the pattern's only home. A later table copying it is copying
-- something that was reviewed; a later table inventing its own is the one
-- review question worth asking every time.
COMMENT ON SCHEMA people IS
  'People module. Every table: ENABLE + FORCE row level security, policy on '
  'tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid, '
  'USING and WITH CHECK. See 20260922140000_people_bootstrap.sql.';
