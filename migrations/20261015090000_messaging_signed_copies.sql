-- Documents' signed copies (K7): a signer's own copy once they sign, and the
-- sealed one to every signer once everyone has; and a reminder (K8) to
-- whoever a request waits on now. Guarded as the earlier
-- rewrites are. Expand only.
DO $$
BEGIN
  IF to_regclass('messaging.delivery') IS NOT NULL THEN
    ALTER TABLE messaging.delivery DROP CONSTRAINT IF EXISTS delivery_kind_known;
    ALTER TABLE messaging.delivery ADD CONSTRAINT delivery_kind_known CHECK (
      kind IN (
        'account_invitation', 'profile_reminder', 'webhook_disabled', 'scheduled_report',
        'approval_requested', 'approval_decided', 'approval_expired', 'correction_requested',
        'summary_shared', 'export_shared', 'export_share_requested', 'rest_nudge',
        'inbox_task', 'inbox_update', 'inbox_digest', 'signature_requested', 'signing_code',
        'signature_reminder', 'document_signed', 'document_completed'
      )
    );
  END IF;
END $$;
