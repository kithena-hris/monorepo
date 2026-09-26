-- A custom-field filter answered by its index, not by reading the tenant.
--
-- The directory's `where` is `custom @> $filter` (`matching` in
-- drizzle-person-reader.ts), and `person_custom_idx` (GIN, jsonb_path_ops)
-- answers exactly that. But not for `svc_people`: it is NOBYPASSRLS, `@>` is
-- not LEAKPROOF, and Postgres will not use a predicate that is not as an index
-- condition beneath the tenant policy. So a filter walked the tenant in id
-- order, which is quick when the matches come early and reads all 50,000
-- people when they come last, or for every count.
-- 20260924370000_people_directory_search.sql has the same problem for the
-- text search and the same answer, which this repeats for `custom`; its
-- header has why a SECURITY DEFINER function is safe here. In short: this
-- returns ids only, into `id = ANY(...)` of a query that keeps the policy and
-- the exact `@>` itself, so a bug here can make a filter slower, never wider.
-- It filters to `app.tenant_id` anyway, and with that unset returns nothing.
--
-- `person_custom_idx` needs no change: jsonb_path_ops supports `@>`, the only
-- operator the reader emits, and the function's predicate is the index's.
--
-- `enable_seqscan = off` because a SQL function's body is planned with its
-- argument unknown, and for `custom @> $1` the planner guesses 1% of the table,
-- which it would rather read whole: 100,000 rows to find 100. The GIN index is
-- the only one that can answer `@>`, so the setting chooses it and nothing else.
--
-- The tenant is a FILTER on the aggregate rather than a WHERE, as in the
-- search function, so a tenant the statistics have not seen does not tempt
-- the planner off the GIN index and onto a walk of the tenant.
--
-- ponytail: the GIN index holds every tenant, so a filter value common across
-- tenants reads their matches before the FILTER drops them, and a filter most
-- of a tenant matches hands back most of its ids. Lead the index with
-- `tenant_id` (btree_gin) if either grows large enough to notice.

CREATE OR REPLACE FUNCTION people.person_custom_candidates(filter jsonb)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET enable_seqscan = off
AS $$
  SELECT coalesce(
           array_agg(id) FILTER (
             WHERE tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid),
           '{}')
    FROM people.person
   WHERE custom @> filter
$$;

REVOKE ALL ON FUNCTION people.person_custom_candidates(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION people.person_custom_candidates(jsonb) TO svc_people;
