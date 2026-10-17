-- A member's last working day, from People's `people.person.terminated`, where
-- Performance's retention counts from (PRD §30). Nullable: somebody who has not
-- left has none, and a leaver whose day was never told is never due.
ALTER TABLE performance.member ADD COLUMN left_on date;
