-- A custom-field filter answered by its index, not by reading the tenant; and
-- both directory candidate functions reading their own tenant's matches only.
--
-- The directory's `where` is `custom @> $filter` (`matching` in
-- drizzle-person-reader.ts), and a GIN index over `custom` (jsonb_path_ops)
-- answers exactly that. But not for `svc_people`: it is NOBYPASSRLS, `@>` is
-- not LEAKPROOF, and Postgres will not use a predicate that is not as an index
-- condition beneath the tenant policy. So a filter walked the tenant in id
-- order, which is quick when the matches come early and reads all 50,000
-- people when they come last, or for every count.
-- 20260924370000_people_directory_search.sql has the same problem for the
-- text search and the same answer, which this repeats for `custom`; its
-- header has why a SECURITY DEFINER function is safe here. In short: these
-- return ids only, into `id = ANY(...)` of a query that keeps the policy and
-- the exact predicate itself, so a bug here can make a filter slower, never
-- wider. They read `app.tenant_id` anyway, and with it unset return nothing.
--
-- ### Tenant first
--
-- Both indexes were over every tenant, so a value many tenants share (a
-- site, a department, a common surname fragment) read every tenant's matches
-- before the tenant was checked: three times the work with three tenants,
-- a hundred times with a hundred. Their replacement leads with the tenant
-- (btree_gin gives it a GIN operator class), and each function names the
-- tenant in its WHERE, so the index intersects the two and the heap is read
-- for this tenant's matches alone. With `app.tenant_id` unset the WHERE
-- compares with null, matches nothing, and the aggregate is still `'{}'`.
--
-- The tenant is indexed as `tenant_id::text`, not as the uuid, on purpose:
--
--   * The planner evaluates `current_setting(...)` to estimate a WHERE, so a
--     tenant the statistics have not seen (every new tenant's first import)
--     is estimated at no rows. Given `tenant_id = <uuid>`, it then walks the
--     tenant on `person_tenant_id_key` instead: 50,000 rows for 50 matches.
--     Nothing but the GIN index can answer `tenant_id::text = ...`, so
--     there is no such walk to prefer.
--   * The directory query's own `tenant_id = $1` is leakproof and would take
--     a uuid-led GIN index as a tenant-only bitmap scan, reading the tenant
--     whole. It cannot take a text-led one.
--
-- The setting is cast to uuid and back, so `A…` and `a…` are one tenant, and
-- a value that is not a uuid fails as the policy's own cast does.
--
-- `enable_seqscan = off` because the filter and the pattern are not known at
-- planning either, and for `custom @> $1` the planner guesses 1% of the table,
-- which it would rather read whole: 100,000 rows to find 100. The GIN index
-- is the only one that can answer `@>` or `ILIKE`, so the setting chooses
-- it. A GIN index answers a condition on any one of its columns as well, so
-- nothing that could use the old indexes loses one; no other query reads
-- `custom` by `@>` or the search text by trigram.
--
-- `btree_gin`, like `pg_trgm`, is a trusted extension: the database owner
-- creates it, `migrator` on the VM and the owner role on Neon.
--
-- ponytail: a filter most of a tenant matches still hands back most of its
-- ids, and the outer query probes each. That is this tenant's size, not the
-- database's; a planner-side cap (skip the narrowing past N candidates) is the
-- next step if a tenant's broad filter gets slow.

CREATE EXTENSION IF NOT EXISTS btree_gin;

-- One index for both, not one each. Two indexes that both lead with the
-- tenant can each answer the tenant alone, and for an unseen tenant (an
-- estimate of no rows) the planner took the filter's index for the search's
-- tenant condition and read the whole tenant. With one index, the one index
-- path takes every condition it matches, so the tenant is never looked up
-- without the filter or the pattern beside it.
--
-- The search expression is `person_search_idx`'s and the function's,
-- character for character: the planner matches an index by its expression.
CREATE INDEX IF NOT EXISTS person_tenant_directory_idx ON people.person USING gin (
  (tenant_id::text),
  custom jsonb_path_ops,
  (coalesce(given_name, '') || ' ' || coalesce(family_name, '') || E'\n' ||
   coalesce(preferred_name, '') || ' ' || coalesce(family_name, '') || E'\n' ||
   coalesce(work_email, '')) gin_trgm_ops
);

CREATE OR REPLACE FUNCTION people.person_custom_candidates(filter jsonb)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET enable_seqscan = off
AS $$
  SELECT coalesce(array_agg(id), '{}')
    FROM people.person
   WHERE tenant_id::text = NULLIF(current_setting('app.tenant_id', true), '')::uuid::text
     AND custom @> filter
$$;

REVOKE ALL ON FUNCTION people.person_custom_candidates(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION people.person_custom_candidates(jsonb) TO svc_people;

CREATE OR REPLACE FUNCTION people.person_search_candidates(pattern text)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET enable_seqscan = off
AS $$
  SELECT coalesce(array_agg(id), '{}')
    FROM people.person
   WHERE tenant_id::text = NULLIF(current_setting('app.tenant_id', true), '')::uuid::text
     AND coalesce(given_name, '') || ' ' || coalesce(family_name, '') || E'\n' ||
         coalesce(preferred_name, '') || ' ' || coalesce(family_name, '') || E'\n' ||
         coalesce(work_email, '') ILIKE pattern
$$;

-- CREATE OR REPLACE keeps the grants 20260924370000 set; restated so this
-- file alone says who may call both.
REVOKE ALL ON FUNCTION people.person_search_candidates(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION people.person_search_candidates(text) TO svc_people;

-- Nothing reads the tenant-less indexes now.
DROP INDEX IF EXISTS people.person_custom_idx;
DROP INDEX IF EXISTS people.person_search_idx;
