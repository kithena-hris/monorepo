-- The kinds of message `messaging.delivery` may record, widened for notices
-- (PEO-084, PEO-093).
--
-- Expand only: every existing row is an `account_invitation`, so the new
-- constraint validates against the table as it stands and nothing is rewritten.
-- Both notice kinds are listed here and in 20260924120100, identically, so the
-- two tickets can land in either order without the second narrowing the first.
--
-- Still no body, subject or link column. A notice records its outcome exactly
-- as an invitation does, and `delivery-log.integration.test.ts` still asserts
-- the column list.
ALTER TABLE messaging.delivery DROP CONSTRAINT delivery_kind_known;
ALTER TABLE messaging.delivery ADD CONSTRAINT delivery_kind_known CHECK (
  kind IN ('account_invitation', 'profile_reminder', 'webhook_disabled')
);
