-- The tenants People has work for (PEO-080).
--
-- Background work — the daily headcount snapshot, the reminder sweep, the
-- policy registry's boot load — runs for every tenant, and `svc_people` cannot
-- ask which those are: every other table here answers only for the tenant in
-- `app.tenant_id`, which is the point of them.
--
-- ### Where the list comes from
--
-- From the events People already consumes, not from another service's table.
-- `platform.tenant` is the registry of every tenant, but `svc_people` has no
-- grant on the `platform` schema and should not get one: a module that reads
-- the platform's tables cannot be deployed without them. Instead the consumer
-- records the tenant of every `identity.account.provisioned` and
-- `people.schema.published` it applies. A tenant with neither has no person
-- and no published schema, so no snapshot, no reminder and no policy to load:
-- missing it costs nothing.
--
-- ### Why its RLS differs from the pattern in 20260922140000_people_bootstrap.sql
--
-- A table whose job is to list tenants cannot scope its reads to one tenant.
-- So the two halves of the usual policy are split:
--
--   * **Reading is unscoped** (`USING (true)` for SELECT). The row holds a
--     uuid and a timestamp, nothing about the tenant's people; the service
--     that reads it already processes every tenant's events. Nothing else in
--     this schema is readable without a tenant, and nothing else may be.
--   * **Writing is scoped** (`WITH CHECK` on `app.tenant_id` for INSERT). A
--     unit of work can register only the tenant it is running as, so a
--     consumer bug cannot plant another tenant's id.
--
-- ENABLE and FORCE as everywhere else, so the owner is held to the same two
-- policies. No UPDATE and no DELETE grant: a tenant is never forgotten, for
-- the reason `platform.tenant` never deletes one.
CREATE TABLE people.tenant (
  tenant_id     uuid PRIMARY KEY,
  first_seen_at timestamptz NOT NULL DEFAULT now()
);

-- Tenants that already have a published schema or a person. Reads through the
-- owner's view of those tables: every row where the owner bypasses RLS (Neon's
-- default owner does), none where it does not. The consumer fills in the rest
-- as events arrive, so the backfill is a head start, not a requirement.
INSERT INTO people.tenant (tenant_id)
SELECT tenant_id FROM people.schema_version
UNION
SELECT tenant_id FROM people.person
ON CONFLICT DO NOTHING;

ALTER TABLE people.tenant ENABLE ROW LEVEL SECURITY;
ALTER TABLE people.tenant FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_list ON people.tenant
  FOR SELECT
  USING (true);

CREATE POLICY tenant_register ON people.tenant
  FOR INSERT
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT ON people.tenant TO svc_people;
