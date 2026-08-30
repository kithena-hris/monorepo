-- Which companies a person may sign into, asked before we know which company.
--
-- The sign-in page used to carry the tenant in its URL, so every account lookup
-- happened inside that tenant's transaction and row-level security did the rest.
-- A generic sign-in page has no tenant to enter: the passkey says who the human
-- is, and the question that follows is "and where do they work", which spans
-- every tenant at once.
--
-- `platform.account` carries RLS with FORCE and `svc_identity` does not bypass
-- it, so that question cannot be asked on a normal connection — it returns
-- nothing, which would look like every sign-in failing rather than like a
-- missing setting. Same shape as `delivery_tenant_of()` in the messaging
-- schema: the one query that legitimately crosses tenants gets a function that
-- is allowed to, rather than the service getting a privilege it would then hold
-- for every other query it makes.
--
-- What keeps this safe is the argument. It answers only for one identity, and
-- the only caller reaches it after verifying an assertion signed by that
-- identity's passkey — so the person asking has already proved they are the
-- subject of the answer. It returns no more than the sign-in decision needs.

CREATE OR REPLACE FUNCTION platform.accounts_for_identity(p_identity_id uuid)
RETURNS TABLE (
  account_id  uuid,
  tenant_id   uuid,
  tenant_slug text,
  work_email  text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
-- An empty search_path, so an unqualified name inside this body cannot be
-- resolved against a schema somebody else controls. A SECURITY DEFINER function
-- without this is the classic way to hand out the definer's rights.
SET search_path = ''
AS $$
  SELECT a.id, a.tenant_id, t.slug, a.work_email
    FROM platform.account a
    JOIN platform.tenant  t ON t.id = a.tenant_id
   WHERE a.identity_id = p_identity_id
     -- Only accounts that can actually be signed into, and only at companies
     -- that are still customers. A suspended tenant or a terminated account is
     -- not a choice to be offered; it is a refusal, and it reads as one because
     -- the row simply is not here.
     AND a.status = 'active'
     AND t.status = 'active';
$$;

-- The role is created here if it is absent, the same way the messaging schema
-- creates its own. `svc_identity` is made by `tools/scripts/init-db.sql` for a
-- local compose stack and by hand on a managed database — neither of which
-- exists in the throwaway Postgres an integration test starts, where a bare
-- GRANT fails with "role does not exist" and takes the whole migration with it.
--
-- NOBYPASSRLS spelled out although it is the default, because it is the point
-- of the role: this function is SECURITY DEFINER precisely so that the *one*
-- query which must cross tenants can, and a service role that ignored row-level
-- security everywhere else would make that distinction meaningless.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'svc_identity') THEN
    CREATE ROLE svc_identity NOLOGIN NOBYPASSRLS;
  END IF;
END $$;

REVOKE ALL ON FUNCTION platform.accounts_for_identity(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.accounts_for_identity(uuid) TO svc_identity;
