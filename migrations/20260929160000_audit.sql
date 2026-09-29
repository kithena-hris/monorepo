-- The central activity log (`platform/audit`, `docs/audit.md`): who did what,
-- and when, across every module a company has. Fed only by events; read only
-- by People administrators, HR and Kithena support, which the service checks.
--
-- ### What is deliberately not here
--
-- No value. No salary, no identifier, nothing a record says: an action in
-- words, what it was done to by id and by the name it had, who did it, and
-- the reason they gave. The log cannot show a viewer what the record would not.
--
-- ### Why a schema of its own
--
-- One schema per service, the rule modules and messaging follow. `svc_audit`
-- can see this and nothing else, so a cross-schema read fails at the database.

CREATE SCHEMA IF NOT EXISTS audit;

CREATE TABLE audit.entry (
  tenant_id        uuid        NOT NULL,
  id               uuid        NOT NULL DEFAULT gen_random_uuid(),
  -- The event it came from. Unique per tenant, so a redelivery, a replay or
  -- the relay's snapshot is never a second entry.
  source_event_id  uuid        NOT NULL,
  -- When it happened, and when the module recorded it: the envelope's own.
  occurred_at      timestamptz NOT NULL,
  recorded_at      timestamptz NOT NULL,
  module           text        NOT NULL,
  area             text        NOT NULL,
  -- "Added a field": one plain sentence, as the settings log words it.
  action           text        NOT NULL,
  -- One more sentence, or nothing. Settings in words, never a record's value.
  detail           text,
  actor_kind       text        NOT NULL,
  -- The account that acted; for support, the account whose rights it used.
  actor_account_id uuid,
  -- The back-office operator, when Kithena support acted.
  on_behalf_of     uuid,
  -- What it was done to: a person, an account, a setting, an export …
  subject_kind     text,
  subject_id       text,
  -- Its name at the time: a field's label, a location's name. Never a value.
  subject_label    text,
  -- What the actor gave as the reason, when there was one.
  reason           text,

  PRIMARY KEY (tenant_id, id),
  CONSTRAINT entry_once UNIQUE (tenant_id, source_event_id),
  CONSTRAINT entry_module_known CHECK (module IN ('people', 'identity')),
  CONSTRAINT entry_area_known CHECK (area IN (
    'fields', 'organisation', 'roles', 'integrations',
    'imports_exports', 'sensitive_access', 'sign_in'
  )),
  CONSTRAINT entry_actor_known CHECK (actor_kind IN ('person', 'support', 'system', 'integration')),
  -- Support is always somebody: the operator is the point of recording it.
  CONSTRAINT entry_support_names_operator CHECK (actor_kind <> 'support' OR on_behalf_of IS NOT NULL),
  CONSTRAINT entry_subject_known CHECK (subject_kind IS NULL OR subject_kind IN (
    'person', 'account', 'setting', 'export', 'import', 'request', 'session'
  )),
  CONSTRAINT entry_action_sane CHECK (length(action) BETWEEN 1 AND 200),
  CONSTRAINT entry_detail_sane CHECK (detail IS NULL OR length(detail) <= 500),
  CONSTRAINT entry_subject_sane CHECK (subject_label IS NULL OR length(subject_label) <= 300),
  CONSTRAINT entry_reason_sane CHECK (reason IS NULL OR length(reason) <= 500)
);

-- Newest first, which is how it is read.
CREATE INDEX entry_recent_idx ON audit.entry (tenant_id, occurred_at DESC, id DESC);
-- One person's acts, and what was done to one record.
CREATE INDEX entry_actor_idx ON audit.entry (tenant_id, actor_account_id, occurred_at DESC);
CREATE INDEX entry_subject_idx ON audit.entry (tenant_id, subject_id, occurred_at DESC);
-- Which support sign-in an action by support came from: the operator's latest
-- sign-in at the company before it.
CREATE INDEX entry_support_sign_in_idx ON audit.entry (tenant_id, on_behalf_of, occurred_at DESC)
  WHERE area = 'sign_in';

-- The isolation form messaging and People use: FORCE, because an owner
-- bypasses its own policies otherwise; NULLIF, because an unset tenant is the
-- empty string and `''::uuid` raises rather than matching nothing.
ALTER TABLE audit.entry ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.entry FORCE  ROW LEVEL SECURITY;
CREATE POLICY entry_tenant_isolation ON audit.entry
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- ---------------------------------------------------------------- retention
--
-- The only way an entry leaves: entries older than the cutoff, for every
-- tenant, which a tenant policy cannot express. SECURITY DEFINER, pinned, and
-- only this; `svc_audit` has no DELETE, so nothing else in the service can
-- remove a line of the log. Called only when `AUDIT_RETENTION_DAYS` is set,
-- which it is not until PEO-129 decides a period: until then nothing goes.
CREATE OR REPLACE FUNCTION audit.purge_before(p_cutoff timestamptz)
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
SET search_path = audit, pg_temp
AS $$
  WITH gone AS (DELETE FROM audit.entry WHERE occurred_at < p_cutoff RETURNING 1)
  SELECT count(*) FROM gone;
$$;

REVOKE ALL ON FUNCTION audit.purge_before(timestamptz) FROM PUBLIC;

-- ------------------------------------------------------------------- role --
--
-- Made here, NOLOGIN, so the migration stands alone wherever it runs (the
-- reasoning is `20260824090000_messaging.sql`'s). Its login comes from whoever
-- may grant one: `tools/scripts/init-db.sql` locally, `deploy.sh migrate` on
-- the VM.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'svc_audit') THEN
    CREATE ROLE svc_audit NOLOGIN NOBYPASSRLS;
  END IF;
END $$;

GRANT USAGE ON SCHEMA audit TO svc_audit;
-- Appended and read; never changed. No UPDATE, no DELETE.
GRANT SELECT, INSERT ON audit.entry TO svc_audit;
GRANT EXECUTE ON FUNCTION audit.purge_before(timestamptz) TO svc_audit;
