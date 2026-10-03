-- A member's work address (TOF-110, TOF-111). Expand only: one nullable column.
--
-- How a calendar or chat app knows whose calendar or status is theirs:
-- People's `hired` carries it, and an import or SCIM may. Never on an event
-- Time Off raises, and never on a screen it draws.
ALTER TABLE timeoff.member
  ADD COLUMN work_email text;
