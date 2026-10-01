-- An Insights summary sent to somebody (design AI6, MA5): the document as the
-- sender approved it, rewritten for what the recipient may see, for the
-- recipient to open signed in. The email that announces it carries a link and
-- nothing else; this row is what the link opens, for seven days.
--
-- Aggregates and the sender's words, never a person's record: the points are
-- counts the cohort minimum already passed, and team names only where the
-- recipient could read them.

CREATE TABLE people.shared_summary (
  tenant_id            uuid        NOT NULL,
  id                   uuid        NOT NULL,
  sender_account_id    uuid        NOT NULL,
  recipient_account_id uuid        NOT NULL,
  format               text        NOT NULL,
  document             jsonb       NOT NULL,
  created_at           timestamptz NOT NULL,
  expires_at           timestamptz NOT NULL,

  PRIMARY KEY (tenant_id, id),
  CONSTRAINT shared_summary_format_known CHECK (format IN ('pdf', 'email')),
  CONSTRAINT shared_summary_seven_days CHECK (
    expires_at > created_at AND expires_at <= created_at + interval '7 days'
  )
);

CREATE INDEX shared_summary_recipient_idx
  ON people.shared_summary (tenant_id, recipient_account_id, created_at DESC);

-- The isolation form from 20260922140000_people_bootstrap.sql, unchanged.
ALTER TABLE people.shared_summary ENABLE ROW LEVEL SECURITY;
ALTER TABLE people.shared_summary FORCE  ROW LEVEL SECURITY;
CREATE POLICY shared_summary_tenant_isolation ON people.shared_summary
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, DELETE ON people.shared_summary TO svc_people;

-- ### The kind `messaging.delivery` records it under
--
-- Widened, as 20260926170000 did, when messaging's table is in this database:
-- every notice kind messaging sends, the summary's among them.
DO $$
BEGIN
  IF to_regclass('messaging.delivery') IS NOT NULL THEN
    ALTER TABLE messaging.delivery DROP CONSTRAINT IF EXISTS delivery_kind_known;
    ALTER TABLE messaging.delivery ADD CONSTRAINT delivery_kind_known CHECK (
      kind IN (
        'account_invitation', 'profile_reminder', 'webhook_disabled', 'scheduled_report',
        'approval_requested', 'approval_decided', 'approval_expired', 'correction_requested',
        'summary_shared'
      )
    );
  END IF;
END
$$;
