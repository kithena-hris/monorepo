-- The company as People knows it: its slug and its name (PEO-099).
--
-- A reminder email (PEO-084) links to the company's own origin,
-- `<slug>.app.kithena.com`, and names the company. Both belong to the back
-- office, in `platform.tenant`, which `svc_people` has no grant on and must
-- not need. So People keeps a copy, filled from `identity.tenant.provisioned`
-- and corrected by `identity.tenant.amended`, beside the other tenant
-- settings.
--
-- `company_as_of` is the `occurredAt` of the event the copy came from. A
-- rename delivered late must not overwrite a later one, so an event older
-- than the copy is ignored: the column is how "newer" is known.
--
-- Expand only: nullable, filled as events arrive. A tenant created before
-- this has no copy until its next amendment; nothing reads these yet.
ALTER TABLE people.tenant_settings
  ADD COLUMN slug          text,
  ADD COLUMN display_name  text,
  ADD COLUMN company_as_of timestamptz;
