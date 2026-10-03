-- Where messaging reaches a member (TOF-098), and how a calendar or chat app
-- knows whose calendar or status is theirs (TOF-110, TOF-111): People's work
-- email, from `people.person.hired` and a profile update naming `work_email`,
-- or an import or SCIM. Nullable and added empty, an expand: a reader skips a
-- member without one. Contact data, as People classifies it; never on an
-- event Time Off raises, and never on a screen it draws.
ALTER TABLE timeoff.member ADD COLUMN work_email text;
