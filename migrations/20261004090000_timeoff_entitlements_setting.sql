-- The modules the company bought, as identity last recorded them
-- (`identity.tenant.entitlements_changed`, PEO-114): one setting document,
-- newest wins. Time Off's caller check reads it before the router's
-- deployment-wide list, as People's does.
--
-- Widening the list of keys is an expand: every row already there still passes.
ALTER TABLE timeoff.setting DROP CONSTRAINT setting_key_known;
ALTER TABLE timeoff.setting ADD CONSTRAINT setting_key_known
  CHECK (key IN (
    'auto_approval', 'attendance_rules', 'parental_company', 'policy_shadows', 'cohort_minimum',
    'escalation', 'chat_answers', 'entitlements'
  ));
