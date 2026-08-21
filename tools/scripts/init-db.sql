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
END $$;

GRANT USAGE ON SCHEMA people  TO svc_people;
GRANT USAGE ON SCHEMA timeoff TO svc_timeoff;
