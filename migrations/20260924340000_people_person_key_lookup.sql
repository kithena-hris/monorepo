-- Every foreign key into `people.person` is checked by a key lookup.
--
-- Six foreign keys reference `people.person (tenant_id, id)`: the manager,
-- the history, the secrets, both columns of the unique claims, and the
-- completeness gaps. Postgres checks each row they write with
--
--   SELECT 1 FROM ONLY people.person x
--    WHERE tenant_id = $1 AND id = $2 FOR KEY SHARE OF x
--
-- and caches the plan on the connection. For a tenant the statistics have not
-- seen, the planner expects the tenant to hold no rows, and then any index
-- that starts with `tenant_id` looks as cheap as the key. That is every new
-- tenant's first import: one transaction, which autovacuum cannot see into
-- however long it runs. `person_manager_idx` won the tie by being a level
-- shorter than `person_tenant_id_key` (every null manager deduplicates into
-- one posting list), and each check walked the tenant to find one row. The
-- checks for 20,000 people written that way took 12 s, and for 50,000, 75 s.
--
-- So no other index on the table can answer `tenant_id = $1` alone. What is
-- left for that predicate is `person_tenant_id_key` and `person_pkey`, and
-- either is a key lookup whatever the statistics say. The two replaced
-- indexes keep serving their queries:
--
--   * "Who reports to this person" always names the manager: `manager_id =
--     $1`, or a join on `p.manager_id = b.id`. Either proves `manager_id IS
--     NOT NULL`, so the partial index serves both, and it is smaller: most
--     people manage nobody, and nobody reports to null.
--   * `person_directory_idx` was only ever read by its `(tenant_id, status)`
--     prefix: the arrivals job's `status = 'pre_hire'` and the review queue's
--     `status = 'notice'`. The directory pages by id. Both queries give the
--     status and the tenant, so `(status, tenant_id)` answers them as before,
--     and with no status it is not an index Postgres can use.
--
-- `person-tables.integration.test.ts` fails if a later index wins the check
-- again. One case no index can fix: a plan cached while the table had been
-- analyzed at a page or two is a sequential scan, and stays one until the
-- next ANALYZE.
--
-- Expand-contract: the replacements exist before the originals go, and
-- nothing refers to an index by name.

CREATE INDEX IF NOT EXISTS person_reports_idx
  ON people.person (tenant_id, manager_id)
  WHERE manager_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS person_status_idx
  ON people.person (status, tenant_id);

DROP INDEX IF EXISTS people.person_manager_idx;
DROP INDEX IF EXISTS people.person_directory_idx;
