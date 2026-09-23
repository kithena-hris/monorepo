-- Who holds a tenant role in People (PEO-112): `hr`, `finance`,
-- `people_admin` (PRD §6.6).
--
-- OpenFGA answers every check, as PEO-092 built it. This table is the ledger
-- its tenant-role tuples are written from, for the reason `people.person` is
-- the ledger of the `account` and `reports_to` tuples: a grant is a row and a
-- `people.role.granted` outbox row in one transaction, and the consumer
-- brings OpenFGA in line with the rows. Writing the tuple beside the event
-- would be a dual write. And "never revoke the last people_admin" needs a
-- count that is true under concurrency, which a lagging projection cannot
-- give and a locked table can.
--
-- A grant is a row and a revocation deletes it; the history is the events,
-- which carry who, whom, which role and why.

CREATE TABLE people.role_grant (
  tenant_id   uuid        NOT NULL,
  -- The account the role is held by: OpenFGA's `user:<account>`.
  account_id  uuid        NOT NULL,
  role        text        NOT NULL,
  granted_at  timestamptz NOT NULL DEFAULT now(),
  -- The account that granted it; null when the back office named the first
  -- administrator, or for a grant this migration carried over.
  granted_by  uuid,
  PRIMARY KEY (tenant_id, account_id, role),
  CONSTRAINT role_grant_role_known CHECK (role IN ('hr', 'finance', 'people_admin'))
);

-- Carried over: what the old "first person administers the tenant" rule
-- (PEO-092) granted, so a tenant that relied on it keeps its administrator
-- when the rule goes. The same choice the rule made — the earliest person,
-- with an account, who has not left — and the same two roles; their OpenFGA
-- tuples already exist. Before row-level security is switched on, and read
-- through the owner's view of `people.person` as 20260923160000 reads it:
-- every tenant where the owner bypasses RLS, as Neon's does.
INSERT INTO people.role_grant (tenant_id, account_id, role)
SELECT first.tenant_id, first.identity_account_id, role.name
  FROM (
    SELECT DISTINCT ON (tenant_id) tenant_id, identity_account_id, status
      FROM people.person
     ORDER BY tenant_id, created_at, id
  ) AS first
 CROSS JOIN (VALUES ('people_admin'), ('hr')) AS role(name)
 WHERE first.identity_account_id IS NOT NULL
   AND first.status NOT IN ('terminated', 'discarded')
ON CONFLICT DO NOTHING;

-- Never the last `people_admin`. The application refuses it, and so does
-- this, for any path that skips the application. The advisory lock is the
-- application's too (`drizzleRoleStore.lock`), so two revocations in one
-- tenant queue and the second sees the first's delete, which a bare count
-- under READ COMMITTED would not.
CREATE FUNCTION people.role_grant_keep_an_admin()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.role = 'people_admin' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('people.role_grant:' || OLD.tenant_id::text, 0));
    IF NOT EXISTS (
      SELECT 1 FROM people.role_grant
       WHERE tenant_id = OLD.tenant_id AND role = 'people_admin' AND account_id <> OLD.account_id
    ) THEN
      RAISE EXCEPTION 'the last people_admin of a tenant cannot be revoked'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'role_grant_keep_an_admin';
    END IF;
  END IF;
  RETURN OLD;
END $$;

CREATE TRIGGER role_grant_keep_an_admin
  BEFORE DELETE ON people.role_grant
  FOR EACH ROW EXECUTE FUNCTION people.role_grant_keep_an_admin();

ALTER TABLE people.role_grant ENABLE ROW LEVEL SECURITY;
ALTER TABLE people.role_grant FORCE  ROW LEVEL SECURITY;
CREATE POLICY role_grant_tenant_isolation ON people.role_grant
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- No UPDATE: a role is held or it is not.
GRANT SELECT, INSERT, DELETE ON people.role_grant TO svc_people;
