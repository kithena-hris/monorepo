-- Settings › Roles' table of everybody who signs in, a keyset page at a time
-- as it scrolls (`drizzle-role-store.ts`, `candidates`): by family name,
-- given name and id, a name not yet known as empty.
--
-- Expand only: an index, nothing read or written differently.
CREATE INDEX person_role_candidates
  ON people.person (tenant_id, (coalesce(family_name, '')), (coalesce(given_name, '')), id)
  WHERE identity_account_id IS NOT NULL;
