-- A leaver's tenant roles end with their access (PEO-109 × PEO-112).
--
-- When `people.person.access_ended` is raised, People revokes every tenant
-- role the leaver's account holds, in the same transaction. The last
-- `people_admin` included: a role left on an account whose access has ended
-- would come back with the account on a rehire, and nobody decided that.
-- `role_grant_keep_an_admin` refused that one delete for every path, so it now
-- lets it through when — and only when — the account belongs to a person whose
-- access has ended (`access_ended_at`, 20260924220000). A tenant left without
-- an administrator is recovered as one that lost every one always was: the
-- back office names another (`identity.tenant.administrator_named`).
--
-- Replacing the function body only; the trigger and its lock are unchanged.
CREATE OR REPLACE FUNCTION people.role_grant_keep_an_admin()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.role = 'people_admin' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('people.role_grant:' || OLD.tenant_id::text, 0));
    IF NOT EXISTS (
      SELECT 1 FROM people.role_grant
       WHERE tenant_id = OLD.tenant_id AND role = 'people_admin' AND account_id <> OLD.account_id
    ) AND NOT EXISTS (
      SELECT 1 FROM people.person
       WHERE tenant_id = OLD.tenant_id
         AND identity_account_id = OLD.account_id
         AND access_ended_at IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'the last people_admin of a tenant cannot be revoked'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'role_grant_keep_an_admin';
    END IF;
  END IF;
  RETURN OLD;
END $$;
