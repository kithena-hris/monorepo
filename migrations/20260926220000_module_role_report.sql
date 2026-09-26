-- Who holds each module's administrator roles, as the module last reported it.
--
-- `platform.tenant_administrator` is what the back office set; a module keeps
-- its own roles (`people.role_grant`) and the company grants and revokes them
-- there. The back office shows both and highlights where they differ, without
-- reading a module's schema and without keeping them in sync. So the module
-- reports: `PUT /api/internal/tenants/<id>/module-roles/<entitlement>`, the
-- whole list each time, and this keeps the newest per module.
--
-- A read model, nothing more. Nothing decides anything from it except what
-- the back office warns an operator about.
--
-- Expand only, per CLAUDE.md: a new table, nothing existing changes.
CREATE TABLE platform.module_role_report (
  tenant_id           uuid        NOT NULL REFERENCES platform.tenant (id),
  entitlement         text        NOT NULL,
  -- What naming somebody grants in the module, e.g. {people_admin,hr}.
  administrator_roles text[]      NOT NULL,
  -- [{ "accountId": uuid, "roles": [text] }], `ModuleRoleReport.holders`.
  holders             jsonb       NOT NULL,
  -- When the module read its roles; an older report never replaces a newer.
  as_of               timestamptz NOT NULL,
  received_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, entitlement),
  CONSTRAINT module_role_report_entitlement_shape CHECK (entitlement ~ '^module\.[a-z]{2,32}$'),
  CONSTRAINT module_role_report_holders_array CHECK (jsonb_typeof(holders) = 'array')
);

ALTER TABLE platform.module_role_report ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.module_role_report FORCE  ROW LEVEL SECURITY;
CREATE POLICY module_role_report_tenant_isolation ON platform.module_role_report
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE ON platform.module_role_report TO svc_identity;
