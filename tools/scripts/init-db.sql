-- Extensions the platform depends on. See section 8 of the stack doc.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
CREATE EXTENSION IF NOT EXISTS vector;

-- One schema per module. No module may read another's schema.
CREATE SCHEMA IF NOT EXISTS people;
CREATE SCHEMA IF NOT EXISTS timeoff;
CREATE SCHEMA IF NOT EXISTS platform;

-- Separate database for OpenFGA's own storage.
SELECT 'CREATE DATABASE openfga OWNER kithena'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'openfga')\gexec

-- Per-module roles. Each service connects as its own role and can see
-- nothing else, so cross-schema joins fail at the database, not in review.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'svc_people') THEN
    CREATE ROLE svc_people LOGIN PASSWORD 'kithena';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'svc_timeoff') THEN
    CREATE ROLE svc_timeoff LOGIN PASSWORD 'kithena';
  END IF;
  -- The identity service is not a module and gets the platform schema instead.
  --
  -- NOBYPASSRLS is spelled out although it is already the default, because it
  -- is the whole point of the role existing. docs/environments.md records the
  -- measurement: a role carrying BYPASSRLS reads every tenant's rows whatever
  -- the policy says, and Neon's default owner carries it. A role that must be
  -- constrained should say so where it is created.
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'svc_identity') THEN
    CREATE ROLE svc_identity LOGIN PASSWORD 'kithena' NOBYPASSRLS;
  END IF;
END $$;

GRANT USAGE ON SCHEMA people   TO svc_people;
GRANT USAGE ON SCHEMA timeoff  TO svc_timeoff;
GRANT USAGE ON SCHEMA platform TO svc_identity;

-- Table privileges cannot be granted here: this file runs at container
-- initialisation, before any migration has created a table. Default privileges
-- cover the tables Atlas is about to create, and are scoped to the role that
-- creates them — `kithena` runs the migrations, so the grant follows from it.
ALTER DEFAULT PRIVILEGES FOR ROLE kithena IN SCHEMA platform
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO svc_identity;
