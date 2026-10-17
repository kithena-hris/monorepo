-- The central activity log hears from every module (`docs/audit.md`): each
-- raises `<module>.activity.recorded`, and the log keeps it under the
-- module's name, so a module's own Activity log is this one filtered to it.
--
-- Expand only: the module and area lists grow, a module names its own subject
-- kinds, and three columns arrive with defaults that describe every entry
-- already here (done, from no surface in particular, not from AI).

ALTER TABLE audit.entry DROP CONSTRAINT entry_module_known;
ALTER TABLE audit.entry ADD CONSTRAINT entry_module_known CHECK (module IN (
  'people', 'identity', 'timeoff', 'documents', 'recruiting', 'onboarding', 'performance'
));

ALTER TABLE audit.entry DROP CONSTRAINT entry_area_known;
ALTER TABLE audit.entry ADD CONSTRAINT entry_area_known CHECK (area IN (
  'fields', 'organisation', 'roles', 'integrations',
  'imports_exports', 'sensitive_access', 'sign_in',
  'settings', 'records', 'access', 'ai'
));

-- A module names what it acted on (`cycle`, `document`, `job`): a word, not a list here.
ALTER TABLE audit.entry DROP CONSTRAINT entry_subject_known;
ALTER TABLE audit.entry ADD CONSTRAINT entry_subject_known CHECK (
  subject_kind IS NULL OR subject_kind ~ '^[a-z][a-z_]{0,39}$'
);

ALTER TABLE audit.entry
  ADD COLUMN outcome text    NOT NULL DEFAULT 'done',
  ADD COLUMN via     text,
  ADD COLUMN ai      boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT entry_outcome_known CHECK (outcome IN ('done', 'refused')),
  ADD CONSTRAINT entry_via_sane CHECK (via IS NULL OR length(via) BETWEEN 1 AND 40);

-- One module's activity, newest first: how a module's Activity log reads it.
CREATE INDEX entry_module_idx ON audit.entry (tenant_id, module, occurred_at DESC, id DESC);

-- --------------------------------------------------------- module_admin --
--
-- Who administers which module, from identity's
-- `identity.tenant.administrator_named` / `_removed`, which the log already
-- reads: the people who may read their module's activity. A removal is kept as
-- `named = false` with its time, so a redelivered older naming cannot undo it.
CREATE TABLE audit.module_admin (
  tenant_id  uuid        NOT NULL,
  module     text        NOT NULL,
  account_id uuid        NOT NULL,
  named      boolean     NOT NULL,
  as_of      timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, module, account_id)
);

ALTER TABLE audit.module_admin ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.module_admin FORCE  ROW LEVEL SECURITY;
CREATE POLICY module_admin_tenant_isolation ON audit.module_admin
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE ON audit.module_admin TO svc_audit;
