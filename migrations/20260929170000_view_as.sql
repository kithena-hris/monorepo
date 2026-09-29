-- Viewing as an employee: a People administrator sees the app exactly as one
-- employee does, read-only, for thirty minutes at most
-- (`docs/auth-administration.md`, "Viewing as an employee").
--
-- Expand-only: every existing row satisfies every new constraint, and nothing
-- an older build writes is refused.
--
-- 1. A view-as session is a `platform.session` row on the *employee's*
--    account, carrying the administrator (`viewed_by`) and why (`reason`). Like
--    a support session it holds no slot, so the employee's own devices keep
--    theirs and nobody is evicted.
--
--    `viewed_by` rather than support's `impersonated_by`: that column is a
--    back-office operator (its foreign key says so), and every reader of it —
--    the token's `act`, the router's `impersonatedBy`, People — takes it to
--    mean Kithena support, a full administrator. A view-as session must never
--    be mistaken for one, so it lives in a column nothing old reads.
--
--    The shape CHECK replaces `session_support_shape` with the three shapes a
--    session can have. It admits every row the old one did.
-- 2. `platform.view_as_access`, the durable record: one row per start,
--    written in the same transaction as the session and its event, kept when
--    the session goes. It is what lets the end be recorded once — by the
--    administrator, or when the thirty minutes are found to have run out.

-- ------------------------------------------------------------------- 1 ----

ALTER TABLE platform.session
  ADD COLUMN IF NOT EXISTS viewed_by uuid REFERENCES platform.account (id);

COMMENT ON COLUMN platform.session.viewed_by IS
  'The People administrator a view-as session belongs to; the session is the employee''s account. Null otherwise.';

ALTER TABLE platform.session
  DROP CONSTRAINT IF EXISTS session_support_shape,
  ADD CONSTRAINT session_shape CHECK (
    -- A person's own session: a slot, nobody behind it.
    (impersonated_by IS NULL AND viewed_by IS NULL AND reason IS NULL AND slot IS NOT NULL)
    OR
    -- Kithena support: an operator, a reason, no slot, an hour.
    (impersonated_by IS NOT NULL AND viewed_by IS NULL AND reason IS NOT NULL AND slot IS NULL
      AND expires_at <= started_at + interval '1 hour')
    OR
    -- Viewing as an employee: an administrator who is not the employee, a
    -- reason, no slot, thirty minutes.
    (viewed_by IS NOT NULL AND impersonated_by IS NULL AND reason IS NOT NULL AND slot IS NULL
      AND viewed_by <> account_id
      AND expires_at <= started_at + interval '30 minutes')
  );

-- ------------------------------------------------------------------- 2 ----

CREATE TABLE IF NOT EXISTS platform.view_as_access (
  id                 uuid PRIMARY KEY,
  tenant_id          uuid NOT NULL REFERENCES platform.tenant (id),
  admin_account_id   uuid NOT NULL REFERENCES platform.account (id),
  subject_account_id uuid NOT NULL REFERENCES platform.account (id),
  reason             text NOT NULL,
  -- People's answer, at the start, to whether the employee's view shows
  -- special-category data.
  special_category   boolean NOT NULL,
  -- Not a foreign key: the session is deleted when it ends, and this row is
  -- the record that it existed.
  session_id         uuid NOT NULL UNIQUE,
  started_at         timestamptz NOT NULL,
  expires_at         timestamptz NOT NULL,
  ended_at           timestamptz,
  ended_by           text,

  CONSTRAINT view_as_access_reason_sane CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
  CONSTRAINT view_as_access_not_self CHECK (admin_account_id <> subject_account_id),
  CONSTRAINT view_as_access_thirty_minutes CHECK (
    expires_at > started_at AND expires_at <= started_at + interval '30 minutes'
  ),
  CONSTRAINT view_as_access_ended CHECK (
    (ended_at IS NULL AND ended_by IS NULL)
    OR (ended_at IS NOT NULL AND ended_by IN ('admin', 'time_limit')
        AND ended_at >= started_at AND ended_at <= expires_at)
  )
);

-- The open ones, which every session check at the company looks through for
-- any whose time has run out.
CREATE INDEX IF NOT EXISTS view_as_access_open_idx
  ON platform.view_as_access (tenant_id, expires_at)
  WHERE ended_at IS NULL;

ALTER TABLE platform.view_as_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.view_as_access FORCE  ROW LEVEL SECURITY;
CREATE POLICY view_as_access_tenant_isolation ON platform.view_as_access
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'svc_identity') THEN
    CREATE ROLE svc_identity NOLOGIN NOBYPASSRLS;
  END IF;
END $$;

-- The record is the service's to add to and to close, never to rewrite: it
-- may set when a row ended and how, and nothing else, and it may delete none.
GRANT SELECT, INSERT ON platform.view_as_access TO svc_identity;
REVOKE UPDATE, DELETE, TRUNCATE ON platform.view_as_access FROM svc_identity;
GRANT UPDATE (ended_at, ended_by) ON platform.view_as_access TO svc_identity;
