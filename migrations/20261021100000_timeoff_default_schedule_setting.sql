-- The company's working week (T33): the schedule anyone without one of their
-- own works, set by HR instead of fixed in code. One setting document;
-- without it the week is Monday to Friday, 09:00 to 17:30, as before.
--
-- Widening the list of keys is an expand: every row already there still passes.
ALTER TABLE timeoff.setting DROP CONSTRAINT setting_key_known;
ALTER TABLE timeoff.setting ADD CONSTRAINT setting_key_known
  CHECK (key IN (
    'auto_approval', 'attendance_rules', 'parental_company', 'policy_shadows', 'cohort_minimum',
    'escalation', 'chat_answers', 'entitlements', 'default_schedule'
  ));
