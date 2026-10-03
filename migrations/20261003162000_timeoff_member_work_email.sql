-- Where messaging reaches a member (TOF-098): People's work email, from
-- `people.person.hired` and a profile update naming `work_email`, or an
-- import. Nullable and added empty, an expand: nothing reads it but a nudge,
-- which skips a member without one. Contact data, as People classifies it.
ALTER TABLE timeoff.member ADD COLUMN work_email text;
