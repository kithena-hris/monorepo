-- The Inbox's email (INB-050): notices for a task and for an update, and the
-- daily digest that gathers the updates a person chose to read once a day.
--
-- `messaging.inbox_digest` holds what waits for tomorrow's digest: who, for
-- which company, where its button goes, and when. Never what the update
-- said: the digest counts, and the Inbox, signed in, shows. `sent_at` is set
-- as a digest takes them; a row sent is kept a little while and then swept.
--
-- `messaging.inbox_digest_tenants()` answers the one question the daily run
-- has to ask across every company, which companies have anything waiting,
-- and nothing else: SECURITY DEFINER for the reason `delivery_tenant_of`
-- gives.
--
-- Guarded like the earlier rewrites, so a module's own test database, which
-- has no messaging schema, migrates all the same. Expand only.
DO $$
BEGIN
  IF to_regclass('messaging.delivery') IS NOT NULL THEN
    ALTER TABLE messaging.delivery DROP CONSTRAINT IF EXISTS delivery_kind_known;
    ALTER TABLE messaging.delivery ADD CONSTRAINT delivery_kind_known CHECK (
      kind IN (
        'account_invitation', 'profile_reminder', 'webhook_disabled', 'scheduled_report',
        'approval_requested', 'approval_decided', 'approval_expired', 'correction_requested',
        'summary_shared', 'export_shared', 'export_share_requested', 'rest_nudge',
        'inbox_task', 'inbox_update', 'inbox_digest'
      )
    );

    CREATE TABLE IF NOT EXISTS messaging.inbox_digest (
      id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id     uuid        NOT NULL,
      to_email      text        NOT NULL,
      company_name  text        NOT NULL,
      url           text        NOT NULL,
      held_at       timestamptz NOT NULL DEFAULT now(),
      sent_at       timestamptz
    );
    CREATE INDEX IF NOT EXISTS inbox_digest_waiting
      ON messaging.inbox_digest (tenant_id, to_email) WHERE sent_at IS NULL;

    ALTER TABLE messaging.inbox_digest ENABLE ROW LEVEL SECURITY;
    ALTER TABLE messaging.inbox_digest FORCE  ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS inbox_digest_tenant_isolation ON messaging.inbox_digest;
    CREATE POLICY inbox_digest_tenant_isolation ON messaging.inbox_digest
      USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

    CREATE OR REPLACE FUNCTION messaging.inbox_digest_tenants()
    RETURNS SETOF uuid
    LANGUAGE sql
    SECURITY DEFINER
    SET search_path = messaging, pg_temp
    STABLE
    AS $fn$
      SELECT DISTINCT tenant_id FROM messaging.inbox_digest WHERE sent_at IS NULL;
    $fn$;
    REVOKE ALL ON FUNCTION messaging.inbox_digest_tenants() FROM PUBLIC;

    GRANT SELECT, INSERT, UPDATE, DELETE ON messaging.inbox_digest TO svc_messaging;
    GRANT EXECUTE ON FUNCTION messaging.inbox_digest_tenants() TO svc_messaging;
  END IF;
END
$$;
