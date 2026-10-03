-- Time Off's nudge to take a break (TOF-098) is a notice messaging sends and
-- records, so `messaging.delivery.kind` admits it. Outcomes only, as ever:
-- the nudge's words are never stored.
--
-- Guarded like the earlier rewrites, so a database without messaging's
-- schema (a module's own test database) migrates all the same.
DO $$
BEGIN
  IF to_regclass('messaging.delivery') IS NOT NULL THEN
    ALTER TABLE messaging.delivery DROP CONSTRAINT IF EXISTS delivery_kind_known;
    ALTER TABLE messaging.delivery ADD CONSTRAINT delivery_kind_known CHECK (
      kind IN (
        'account_invitation', 'profile_reminder', 'webhook_disabled', 'scheduled_report',
        'approval_requested', 'approval_decided', 'approval_expired', 'correction_requested',
        'summary_shared', 'export_shared', 'export_share_requested', 'rest_nudge'
      )
    );
  END IF;
END
$$;
