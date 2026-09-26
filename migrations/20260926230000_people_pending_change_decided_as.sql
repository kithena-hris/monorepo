-- How a held change was decided, when not by another HR member (PEO-077,
-- PEO-125; PRD §8.6).
--
-- `decided_as`:
--   * `sole_hr`: the requester approved it alone, as the tenant's only HR
--     member, after confirming it. The domain allows it only while nobody
--     else holds `hr`; this allows it only when it is recorded as such.
--   * `identifier_review`: declined because the review of the doubted
--     national identifier it held found errors. The reviewer may be the
--     requester — declining is not approving.
-- Null for an ordinary decision, and for every row written before this.
--
-- `pending_change_not_self_decided` is widened for exactly those two and
-- nothing else: a requester still never rejects their own change (they
-- withdraw it), and never approves it while another HR member could.
--
-- `IS NOT DISTINCT FROM`, not `=`: a null `decided_as` must make the exception
-- false, not unknown, or a CHECK lets the row through.
--
-- Expand only: a nullable column and a wider CHECK.

ALTER TABLE people.pending_change ADD COLUMN decided_as text;

ALTER TABLE people.pending_change
  ADD CONSTRAINT pending_change_decided_as CHECK (
    decided_as IS NULL OR decided_as IN ('sole_hr', 'identifier_review')
  );

ALTER TABLE people.pending_change DROP CONSTRAINT pending_change_not_self_decided;
ALTER TABLE people.pending_change
  ADD CONSTRAINT pending_change_not_self_decided CHECK (
    decided_by IS NULL
    OR state = 'withdrawn'
    OR decided_by <> requested_by
    OR (state = 'approved' AND decided_as IS NOT DISTINCT FROM 'sole_hr')
    OR (state = 'rejected' AND decided_as IS NOT DISTINCT FROM 'identifier_review')
  );
