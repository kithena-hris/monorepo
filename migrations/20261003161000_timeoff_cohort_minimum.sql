-- The smallest group Time Off's insights may describe (PRD §14.2, TOF-097):
-- People's cohort minimum, as `people.settings.changed` last said it, kept
-- as one setting document. Without People it is never written and the
-- insights use People's own floor of 10.
--
-- Widening the list of keys is an expand: every row already there still passes.
ALTER TABLE timeoff.setting DROP CONSTRAINT setting_key_known;
ALTER TABLE timeoff.setting ADD CONSTRAINT setting_key_known
  CHECK (key IN (
    'auto_approval', 'attendance_rules', 'parental_company', 'policy_shadows', 'cohort_minimum'
  ));
