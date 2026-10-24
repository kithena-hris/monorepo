-- What the sign-up page shows already filled in for a hire People invited:
-- the answers HR holds for the tenant's own sign-up questions, by key, for the
-- person to confirm rather than type. Only the questions' keys, which People
-- reports at `collectAt: signup | enrolment` and never above internal. Cleared
-- when the account enrols, so it lives exactly as long as the link.
ALTER TABLE platform.account
  ADD COLUMN IF NOT EXISTS signup_prefill jsonb;
