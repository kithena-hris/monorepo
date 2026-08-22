-- Account counts for the back-office, without handing it every account.
--
-- The back-office lists every company with "3 active, 1 invited" beside each.
-- Those numbers were all zero and had been since the screen was written:
-- `platform.account` carries row-level security with FORCE, `svc_identity` does
-- not bypass it, and the listing runs with no `app.tenant_id` set because it is
-- deliberately looking across tenants. The policy is
--
--   tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
--
-- so with nothing set the comparison is NULL, every row is filtered, and
-- `count(*)` returns 0. Not an error — a wrong number, on a screen, that looks
-- exactly like a company nobody has been invited to yet.
--
-- Three ways out, and why this is the one:
--
--   * Set `app.tenant_id` per tenant and query in a loop. Correct, and N round
--     trips for a page of N. Workable at ten customers, not at ten thousand.
--   * Widen the policy so the service role can read across tenants. That
--     deletes the isolation guarantee for every other query in the service to
--     fix a number on one screen.
--   * A function that is allowed to count and nothing else. This.
--
-- SECURITY DEFINER runs as the owner, which does bypass RLS — so the hole is
-- real and the shape of it is the whole point. It returns three columns, none
-- of them an account: a tenant id and two integers. There is no argument to
-- filter by and no row to leak. A caller learns how many people a company has,
-- which is exactly what the screen shows, and cannot learn who they are.
CREATE OR REPLACE FUNCTION platform.tenant_account_counts()
RETURNS TABLE (tenant_id uuid, active bigint, invited bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
-- Pinned, because a SECURITY DEFINER function that resolves names through the
-- caller's `search_path` runs the caller's `account` table as the owner.
SET search_path = platform, pg_temp
AS $$
  SELECT a.tenant_id,
         count(*) FILTER (WHERE a.status = 'active')  AS active,
         count(*) FILTER (WHERE a.status = 'invited') AS invited
    FROM platform.account a
   GROUP BY a.tenant_id
$$;

-- EXECUTE is not granted to PUBLIC. `CREATE FUNCTION` grants it by default,
-- which on a SECURITY DEFINER function means every role in the database can
-- run it — including ones added later for reasons unrelated to this.
REVOKE ALL ON FUNCTION platform.tenant_account_counts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.tenant_account_counts() TO svc_identity;

-- Keyset pagination needs this to be cheap and total.
--
-- The listing orders by `created_at DESC, id DESC` and pages by comparing the
-- pair, so the index has to match that order exactly or Postgres sorts the
-- whole table to answer each page. `id` is in the key because `created_at`
-- alone is not unique: two tenants created in the same millisecond would make
-- one page skip a row and another repeat it.
CREATE INDEX IF NOT EXISTS tenant_created_at_id
  ON platform.tenant (created_at DESC, id DESC);
