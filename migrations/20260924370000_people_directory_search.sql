-- A directory search answered by an index, not by reading the tenant.
--
-- The search is `ILIKE '%text%'` over the names and work email a viewer may
-- read (`matching` in drizzle-person-reader.ts). Nothing indexes a substring
-- but a trigram index, and under row-level security not even that: `svc_people`
-- is NOBYPASSRLS, and Postgres will not use a query's predicate as an index
-- condition when the predicate is not LEAKPROOF and a policy's is evaluated
-- first. `~~*` is not leakproof (nor is `@>`, `&&` or anything trigram), and
-- only a superuser can declare a function that is. So every search was a
-- sequential scan of the tenant, three case-folded matches a row, twice a
-- page: once for the page and once for its count. At 50,000 people that was
-- 300 ms on CI, the whole of PEO-117's budget.
--
-- So the index is read by a function that runs as its owner, and the owner
-- (the migrating role: BYPASSRLS on the VM) is not held to the policy.
--
-- ### Why a SECURITY DEFINER function is safe here
--
-- 20260923140000_people_retention.sql explains why this repository avoids
-- them: one missed tenant setting and it is a privileged path out of tenant
-- isolation. This one cannot be, because what it returns is only ever a
-- narrowing of a query RLS still guards:
--
--   * It returns person ids, never a row, and only into `id = ANY(...)` of the
--     directory query, which is `svc_people`'s, under the policy, with the
--     search predicate itself still in it. A candidate from the wrong tenant,
--     or one matching on a column the viewer may not search, is dropped there.
--     A bug in this function can make a search slower, not wider.
--   * It filters to `app.tenant_id` anyway, the setting the policy reads, so
--     the list it hands back is no bigger than it has to be. With the setting
--     unset it hands back nothing.
--   * It matches one text that holds every searchable column, so it is a
--     superset of what any viewer's predicate matches: `given family`,
--     `preferred family` and the email, each whole, so any substring of a
--     column or of a full name is a substring of it. `coalesce` because
--     `concat_ws` is not immutable, and an index expression has to be.
--   * `search_path` is pinned and EXECUTE is `svc_people`'s alone, as for
--     `platform.tenant_account_counts`.
--
-- The tenant is a FILTER on the aggregate rather than a WHERE, so the planner
-- has no tenant clause to prefer over the trigram index. For a tenant the
-- statistics have not seen (every new tenant's first import), a WHERE on
-- `tenant_id` estimates one row and walks the tenant instead: 60 ms at
-- 50,000 people against 2 ms.
--
-- ponytail: the trigram index holds every tenant, so a common fragment reads
-- matches from other tenants before the FILTER drops them. Lead the index with
-- `tenant_id` (btree_gin) if a shared database grows large enough to notice.
-- A search under three characters has no trigram and would read the whole
-- index, so the reader does not ask this function for one.
--
-- If the owner cannot bypass RLS (a managed database whose owner is not
-- BYPASSRLS), the function is still correct, just a scan: the policy applies
-- to its query, which already names the tenant it allows.
--
-- `pg_trgm` is a trusted extension: the database owner creates it, which is
-- `migrator` on the VM and the owner role on Neon, neither a superuser.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS person_search_idx ON people.person USING gin ((
  coalesce(given_name, '') || ' ' || coalesce(family_name, '') || E'\n' ||
  coalesce(preferred_name, '') || ' ' || coalesce(family_name, '') || E'\n' ||
  coalesce(work_email, '')
) gin_trgm_ops);

-- The expression is `person_search_idx`'s, character for character: the
-- planner matches an index by its expression, and one that differs is a scan.
CREATE OR REPLACE FUNCTION people.person_search_candidates(pattern text)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT coalesce(
           array_agg(id) FILTER (
             WHERE tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid),
           '{}')
    FROM people.person
   WHERE coalesce(given_name, '') || ' ' || coalesce(family_name, '') || E'\n' ||
         coalesce(preferred_name, '') || ' ' || coalesce(family_name, '') || E'\n' ||
         coalesce(work_email, '') ILIKE pattern
$$;

REVOKE ALL ON FUNCTION people.person_search_candidates(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION people.person_search_candidates(text) TO svc_people;
