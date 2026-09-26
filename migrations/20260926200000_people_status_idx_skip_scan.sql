-- `person_status_idx` carries the id, because Postgres 18 can skip its status.
--
-- 20260924340000_people_person_key_lookup.sql rests on one rule: no index on
-- `people.person` but `person_tenant_id_key` and `person_pkey` can answer
-- `tenant_id = $1` alone. For a tenant the statistics have not seen, the
-- planner expects no rows, and any index that can find "the tenant" then looks
-- as cheap as one that finds the rows asked for. `(status, tenant_id)` kept
-- the rule because, with no status given, Postgres 17 could not use it.
--
-- Postgres 18 can: a B-tree skip scan steps over a leading column with few
-- values (status has a handful) and uses the next. So for a new tenant the
-- directory's `tenant_id = $1 AND id = ANY(<candidates>)` took this index
-- for the tenant alone, left the candidates as a filter, and read all 50,000
-- people to return the 50 a custom-field filter matched:
--
--   Index Scan using person_status_idx on person  (rows=1) (actual rows=50)
--     Index Cond: (tenant_id = '…f2'::uuid)
--     Filter: ((id = ANY ((InitPlan 1).col1)) AND (custom @> '…'::jsonb))
--     Rows Removed by Filter: 49950
--     Index Searches: 3
--
-- where Postgres 17 probed `person_tenant_id_key` with `id = ANY(...)` as its
-- index condition and read the 50.
--
-- With `id` as a third column, the one path this index offers for that query
-- has `id = ANY(...)` in its index condition as well, so the tenant is never
-- looked up without the ids beside it, on 17 or 18. The arrivals job and the
-- review queue give the status and the tenant, and read the same prefix as
-- before.
--
-- Same name, built and swapped in one transaction, so nothing that names the
-- index (a test's plan assertion) changes and there is no moment without one.

DROP INDEX IF EXISTS people.person_status_idx;

CREATE INDEX person_status_idx
  ON people.person (status, tenant_id, id);
