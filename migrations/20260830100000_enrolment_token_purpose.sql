-- Why a link was issued, so the page it opens can stop guessing.
--
-- Both kinds of link land on the same enrolment page, and until now that page
-- inferred what to do from the account's state: an `active` account meant "you
-- already have a passkey, go and sign in". That inference was correct while the
-- only link was an invitation. Recovery broke it, because a recovery link is
-- *always* issued to an active account — so the person who had just asked for a
-- new passkey was told they already had one and offered a sign-in they could
-- not complete, the passkey being the thing they had lost.
--
-- Inferring it from liveness instead — "a live link means recovery" — is closer
-- but still a proxy. The link knows why it exists; it should say so, and then
-- neither the page nor the next reader has to reconstruct the reason from two
-- other columns.
--
-- Expand-contract, like every migration here: the column arrives with a default
-- so existing rows are correct without a backfill pass. Every token issued
-- before this was an invitation, which is exactly what they now say.

ALTER TABLE platform.enrolment_token
  ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'invitation';

-- A CHECK rather than an enum, for the reason `status` is text elsewhere in this
-- schema: the database can gain a third purpose without a type migration, and
-- the value is parsed rather than cast on the way out.
ALTER TABLE platform.enrolment_token
  DROP CONSTRAINT IF EXISTS enrolment_purpose_known;

ALTER TABLE platform.enrolment_token
  ADD CONSTRAINT enrolment_purpose_known CHECK (purpose IN ('invitation', 'recovery'));

COMMENT ON COLUMN platform.enrolment_token.purpose IS
  'invitation: the first link, gated by a second channel. recovery: a
   replacement requested with an email address alone, which is weaker — see
   docs/auth-administration.md and the AccountRecovered event.';
