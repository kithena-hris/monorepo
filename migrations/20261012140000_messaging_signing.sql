-- Documents' two notices for somebody outside the company (Documents K6):
-- a document to sign, and the code that proves the mailbox is theirs.
-- Guarded as the earlier rewrites are. Expand only.
DO $$
BEGIN
  IF to_regclass('messaging.delivery') IS NOT NULL THEN
    ALTER TABLE messaging.delivery DROP CONSTRAINT IF EXISTS delivery_kind_known;
    ALTER TABLE messaging.delivery ADD CONSTRAINT delivery_kind_known CHECK (
      kind IN (
        'account_invitation', 'profile_reminder', 'webhook_disabled', 'scheduled_report',
        'approval_requested', 'approval_decided', 'approval_expired', 'correction_requested',
        'summary_shared', 'export_shared', 'export_share_requested', 'rest_nudge',
        'inbox_task', 'inbox_update', 'inbox_digest', 'signature_requested', 'signing_code'
      )
    );
  END IF;
END $$;
