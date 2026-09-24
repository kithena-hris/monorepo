-- Which modules a company bought (PEO-114).
--
-- Until now the answer was one list per deployment, `KITHENA_ENTITLEMENTS`,
-- so every company on a deployment had the same modules. The back office owns
-- the company, so it owns this too: a column on the registry row, written by
-- identity from the company wizard and the company page, and carried to the
-- modules on `identity.tenant.entitlements_changed`. No module reads this
-- table; each keeps its own copy from the event.
--
-- Expand only, per CLAUDE.md. Nullable, and null keeps its old meaning: a
-- company with nothing recorded has the deployment's list, which is now a
-- default rather than the answer. An empty array is a recorded answer —
-- "bought nothing" — and is not the same as null.
--
-- No row-level security here, as for the rest of `platform.tenant`: it is the
-- registry read before a tenant is known (20260821120000). `svc_identity`
-- reaches the new column through the table's existing grants.
ALTER TABLE platform.tenant
  ADD COLUMN IF NOT EXISTS entitlements text[];

-- `module.<key>`, each at most once. The list of keys is `ModuleKey` in
-- `packages/contracts`, and the application refuses an unknown one; this
-- says only what a constraint can know without that list — the shape, and no
-- repeats — so a path that skips the application cannot store nonsense.
--
-- A function because a CHECK may not hold a subquery. IMMUTABLE is true: it
-- reads nothing but its argument.
CREATE OR REPLACE FUNCTION platform.entitlements_well_formed(list text[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT cardinality(list) <= 32
     AND array_position(list, NULL) IS NULL
     AND NOT EXISTS (SELECT 1 FROM unnest(list) AS e(key) WHERE e.key !~ '^module\.[a-z]{2,32}$')
     AND cardinality(list) = (SELECT count(DISTINCT e.key) FROM unnest(list) AS e(key))
$$;

-- NOT VALID, then validated separately, as 20260822160000 does: the lock is
-- brief and the scan runs under a weaker one. Every existing row is null.
ALTER TABLE platform.tenant
  ADD CONSTRAINT tenant_entitlements_shape
  CHECK (entitlements IS NULL OR platform.entitlements_well_formed(entitlements)) NOT VALID;

ALTER TABLE platform.tenant VALIDATE CONSTRAINT tenant_entitlements_shape;
