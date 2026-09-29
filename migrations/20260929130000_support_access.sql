-- Support access: an operator signs in to a company as its support agent
-- (`docs/auth-administration.md`, "Support access").
--
-- Four things, all expand-only: every existing row satisfies every new
-- constraint, and nothing an older build writes is refused.
--
-- 1. `account.kind`. `member` for a person, `support` for the one account per
--    company the back office signs in as. Not an employee: it is never
--    announced to People, never listed, never counted.
-- 2. A support session is a `platform.session` row on that account, carrying
--    the operator (`impersonated_by`) and why (`reason`). It holds no slot —
--    `slot` is NULL — so it can never take a place from anybody or evict
--    anybody, and several operators can be in at once. The CHECK below makes
--    the two shapes exclusive and caps a support session at one hour from its
--    start, so no writer, however wrong, can store a longer one.
-- 3. `platform.support_access`, the durable audit: one row per start, written
--    in the same transaction as the session and kept when the session goes.
--    No foreign key to the session, deliberately, and no UPDATE or DELETE for
--    the service role.
-- 4. The support account can be signed into no other way. The passkey path
--    asks `accounts_for_identity`, which now returns members only; the
--    back office's counts leave it out; and an enrolment link — the only way a
--    credential is ever attached — cannot be issued for it at all.

-- ------------------------------------------------------------------- 1 ----

ALTER TABLE platform.account
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'member';

ALTER TABLE platform.account
  ADD CONSTRAINT account_kind_known CHECK (kind IN ('member', 'support'));

-- One per company. Two operators starting support at the same moment both try
-- to create it; this makes one of them find the other's instead.
CREATE UNIQUE INDEX IF NOT EXISTS account_support_key
  ON platform.account (tenant_id)
  WHERE kind = 'support';

-- ------------------------------------------------------------------- 2 ----

ALTER TABLE platform.session
  ALTER COLUMN slot DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS impersonated_by uuid REFERENCES platform.operator (id),
  ADD COLUMN IF NOT EXISTS reason text;

ALTER TABLE platform.session
  ADD CONSTRAINT session_support_shape CHECK (
    (impersonated_by IS NULL AND reason IS NULL AND slot IS NOT NULL)
    OR
    (impersonated_by IS NOT NULL AND reason IS NOT NULL AND slot IS NULL
      AND expires_at <= started_at + interval '1 hour')
  );

COMMENT ON COLUMN platform.session.impersonated_by IS
  'The operator a support session belongs to. Null for a person''s own session.';
COMMENT ON COLUMN platform.session.reason IS
  'Why the operator started this support session. Null for a person''s own session.';

-- ------------------------------------------------------------------- 3 ----

CREATE TABLE IF NOT EXISTS platform.support_access (
  id          uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES platform.tenant (id),
  operator_id uuid NOT NULL REFERENCES platform.operator (id),
  reason      text NOT NULL,
  -- Not a foreign key: the session is deleted when it is signed out, revoked
  -- or reaped, and this row is the record that it existed.
  session_id  uuid NOT NULL,
  started_at  timestamptz NOT NULL,
  expires_at  timestamptz NOT NULL,

  CONSTRAINT support_access_reason_sane CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
  CONSTRAINT support_access_one_hour CHECK (
    expires_at > started_at AND expires_at <= started_at + interval '1 hour'
  )
);

CREATE INDEX IF NOT EXISTS support_access_tenant_idx
  ON platform.support_access (tenant_id, started_at DESC);

ALTER TABLE platform.support_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.support_access FORCE  ROW LEVEL SECURITY;
CREATE POLICY support_access_tenant_isolation ON platform.support_access
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- As 20260829090000 does, so this file applies to the throwaway databases the
-- integration tests build from a handful of migrations.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'svc_identity') THEN
    CREATE ROLE svc_identity NOLOGIN NOBYPASSRLS;
  END IF;
END $$;

-- Append-only for the service. The default privileges in `init-db.sql` grant
-- every table in `platform` all four; an audit trail the audited service can
-- edit is not one.
GRANT SELECT, INSERT ON platform.support_access TO svc_identity;
REVOKE UPDATE, DELETE, TRUNCATE ON platform.support_access FROM svc_identity;

-- ------------------------------------------------------------------- 4 ----

-- As 20260829090000, plus `kind = 'member'`: a passkey never offers the
-- support account, whatever identity it is attached to.
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
SET search_path = ''
AS $$
  SELECT a.id, a.tenant_id, t.slug, a.work_email
    FROM platform.account a
    JOIN platform.tenant  t ON t.id = a.tenant_id
   WHERE a.identity_id = p_identity_id
     AND a.status = 'active'
     AND a.kind = 'member'
     AND t.status = 'active';
$$;

-- As 20260822200000, plus `kind = 'member'`: "3 active" means three people.
CREATE OR REPLACE FUNCTION platform.tenant_account_counts()
RETURNS TABLE (tenant_id uuid, active bigint, invited bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = platform, pg_temp
AS $$
  SELECT a.tenant_id,
         count(*) FILTER (WHERE a.status = 'active')  AS active,
         count(*) FILTER (WHERE a.status = 'invited') AS invited
    FROM platform.account a
   WHERE a.kind = 'member'
   GROUP BY a.tenant_id
$$;

-- Replacing keeps the grants these already had; restated for a database where
-- this is the first definition.
REVOKE ALL ON FUNCTION platform.accounts_for_identity(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.accounts_for_identity(uuid) TO svc_identity;
REVOKE ALL ON FUNCTION platform.tenant_account_counts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.tenant_account_counts() TO svc_identity;

-- An enrolment link is how a credential is attached to an account, invitation
-- and recovery alike. None is ever issued for the support account. Runs as the
-- caller inside its tenant transaction, where the account is visible.
CREATE OR REPLACE FUNCTION platform.enrolment_token_not_support()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM platform.account WHERE id = NEW.account_id AND kind = 'support') THEN
    RAISE EXCEPTION 'the support account cannot hold an enrolment link'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS enrolment_token_not_support ON platform.enrolment_token;
CREATE TRIGGER enrolment_token_not_support
  BEFORE INSERT OR UPDATE OF account_id ON platform.enrolment_token
  FOR EACH ROW EXECUTE FUNCTION platform.enrolment_token_not_support();
