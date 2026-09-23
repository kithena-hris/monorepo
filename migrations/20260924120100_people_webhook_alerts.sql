-- Webhook alerts (PEO-093).
--
-- ### Who is told when an endpoint is disabled
--
-- `people.webhook.endpoint_disabled` is the durable notice, raised in the
-- transaction that disables the endpoint. The email beside it goes to an
-- address the admin who registers the endpoint names for exactly that —
-- People holds no list of a tenant's administrators (roles arrive on each
-- request and are never stored), so the endpoint carries its own contact.
-- Required for every new endpoint (the service refuses one without it).
-- Nullable only for endpoints created before this, which are told through the
-- event alone; there are no live customers, so none is expected.
--
-- Expand only. `webhook_endpoint` already has ENABLE and FORCE row level
-- security and its tenant policy from 20260923120000, which cover a new
-- column, and `svc_people`'s table-level grants cover it too.
--
-- Both halves are guarded by `to_regclass`, because each service's integration
-- database applies only its own schema: messaging's has no `people`, People's
-- has no `messaging`. Every deployed database has both.
DO $$
BEGIN
  IF to_regclass('people.webhook_endpoint') IS NOT NULL THEN
    ALTER TABLE people.webhook_endpoint
      ADD COLUMN IF NOT EXISTS alert_email text
        CHECK (alert_email IS NULL OR length(alert_email) BETWEEN 3 AND 320);
  END IF;
END
$$;

-- ### The kind `messaging.delivery` records it under
--
-- Identical to 20260924120000, so PEO-084 and PEO-093 can land in either
-- order without the second narrowing the first.
DO $$
BEGIN
  IF to_regclass('messaging.delivery') IS NOT NULL THEN
    ALTER TABLE messaging.delivery DROP CONSTRAINT IF EXISTS delivery_kind_known;
    ALTER TABLE messaging.delivery ADD CONSTRAINT delivery_kind_known CHECK (
      kind IN ('account_invitation', 'profile_reminder', 'webhook_disabled')
    );
  END IF;
END
$$;
