-- The modules the company bought, as People knows it (PEO-114).
--
-- The back office records a company's modules on `platform.tenant`, which
-- `svc_people` has no grant on and must not need. So People keeps a copy,
-- filled from `identity.tenant.entitlements_changed`, beside the company's
-- slug and name (20260924170100) — on `people.tenant_settings`, whose row
-- isolation (ENABLE + FORCE, the tenant policy of 20260924170000) and grants
-- already cover these columns.
--
-- Null means People was never told: the company has the deployment's list,
-- and the caller's forwarded list is used. A recorded list, empty included,
-- is the answer and wins over anything a caller forwards.
--
-- `entitlements_as_of` is the `occurredAt` of the event the copy came from,
-- so a change delivered late never overwrites a later one.
--
-- Expand only: nullable, filled as events arrive.
ALTER TABLE people.tenant_settings
  ADD COLUMN IF NOT EXISTS entitlements       text[],
  ADD COLUMN IF NOT EXISTS entitlements_as_of timestamptz;
