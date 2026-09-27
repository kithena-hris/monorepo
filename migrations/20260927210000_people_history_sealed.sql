-- Encrypting a field that already holds values.
--
-- When a company switches encryption on for a field, the version that does it
-- seals each person's value into people.person_secret and drops the plain
-- copy from the record. History held that field's earlier values in the
-- clear; they are redacted the one way history may change (retention's
-- redaction: value NULL, stamped once), under a reason of their own, so the
-- timeline still says the field changed and on what date, and nothing says
-- what to.
--
-- Expand only: the set of reasons grows by one; every row that satisfied the
-- old rule satisfies this one.
ALTER TABLE people.person_attribute_history
  DROP CONSTRAINT history_redaction_reason_known,
  ADD CONSTRAINT history_redaction_reason_known CHECK (
    redaction_reason IS NULL OR redaction_reason IN ('retention', 'encrypted')
  );
