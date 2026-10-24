-- `onboarding`: a hire who has signed up to their account and not started.
--
-- Between `pre_hire` and `active` (People PRD §8.1): HR hired them, they set
-- up their account and are filling in what the company asks before the first
-- day, and the start job starts them on it as it starts a pre-hire.
ALTER TABLE people.person DROP CONSTRAINT person_status_known;
ALTER TABLE people.person
  ADD CONSTRAINT person_status_known CHECK (
    status IN ('provisional', 'pre_hire', 'onboarding', 'active', 'on_leave', 'notice', 'terminated', 'discarded', 'merged')
  );
