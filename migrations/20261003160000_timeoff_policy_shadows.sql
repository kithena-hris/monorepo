-- Shadow runs (PRD §6.3, TOF-093): a policy's draft running beside the
-- version in effect for a month, so HR can compare balances before
-- publishing. One document of runs by policy id, like the other settings;
-- nothing is posted to the ledger, and only HR's settings read it.
--
-- Widening the list of keys is an expand: every row already there still passes.
ALTER TABLE timeoff.setting DROP CONSTRAINT setting_key_known;
ALTER TABLE timeoff.setting ADD CONSTRAINT setting_key_known
  CHECK (key IN ('auto_approval', 'attendance_rules', 'parental_company', 'policy_shadows'));
