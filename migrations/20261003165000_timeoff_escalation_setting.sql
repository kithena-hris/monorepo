-- T34's "If nobody decides" (§9.7, TOF-099a): after how many working days a
-- waiting request moves on, to the approver's manager or to HR, and when the
-- daily reminder goes. One setting document; without it the rule is three
-- working days, the manager's manager, 09:00, as before.
--
-- Widening the list of keys is an expand: every row already there still passes.
ALTER TABLE timeoff.setting DROP CONSTRAINT setting_key_known;
ALTER TABLE timeoff.setting ADD CONSTRAINT setting_key_known
  CHECK (key IN (
    'auto_approval', 'attendance_rules', 'parental_company', 'policy_shadows', 'cohort_minimum',
    'escalation'
  ));
