-- What a chat answer may say about private leave (assistant PRD §11.4,
-- AST-029a): whether the company lets the assistant name people on a private
-- leave type in a chat app. One setting document; without it the answer is
-- no, as before. Who switched it, when and which way is
-- `timeoff.settings.changed`, in the outbox beside the write.
--
-- Widening the list of keys is an expand: every row already there still passes.
ALTER TABLE timeoff.setting DROP CONSTRAINT setting_key_known;
ALTER TABLE timeoff.setting ADD CONSTRAINT setting_key_known
  CHECK (key IN (
    'auto_approval', 'attendance_rules', 'parental_company', 'policy_shadows', 'cohort_minimum',
    'escalation', 'chat_answers'
  ));
