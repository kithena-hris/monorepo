-- Kithena support, signed in from the back office (decided 2026-09-29), acts
-- as the company's support account; the log keeps who it really was. The
-- account stays `actor`, so every entry still names one; `on_behalf_of` is
-- the back-office operator who started the session, and `reason` what they
-- said it was for — a ticket number or a sentence. Both null for everybody
-- else, and on every entry before this: expand-only, nothing is rewritten.
ALTER TABLE people.settings_activity
  ADD COLUMN on_behalf_of uuid,
  ADD COLUMN reason text
  CONSTRAINT settings_activity_reason CHECK (reason IS NULL OR length(reason) <= 500);
