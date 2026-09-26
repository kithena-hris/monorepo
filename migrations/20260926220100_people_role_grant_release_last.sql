-- The back office may take the last `people_admin` when the operator confirmed it.
--
-- Removing somebody from People's administrators in the back office revokes
-- their `people_admin` and `hr`. When that would leave the company with no
-- People administrator or no HR, the back office says so and proceeds only on
-- the operator's confirmation, and `identity.tenant.administrator_removed`
-- carries `confirmedLast`. People then revokes — and `role_grant_keep_an_admin`
-- refused the last `people_admin` on every path but a leaver's.
--
-- It now also lets that one delete through when the transaction says so with
-- `people.release_last_admin = 'on'`, which People sets, transaction-local,
-- only while applying a confirmed removal. Every other path still cannot
-- leave a tenant without an administrator by accident. A company left with
-- none is recovered as it always was: the back office names another.
--
-- Replacing the function body only; the trigger and its lock are unchanged.
CREATE OR REPLACE FUNCTION people.role_grant_keep_an_admin()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.role = 'people_admin'
     AND coalesce(current_setting('people.release_last_admin', true), '') <> 'on' THEN
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
