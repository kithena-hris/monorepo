-- The tenant's own sign-up questions, as People last reported them, and which
-- of them each account has answered.
--
-- A People field marked `collectAt: signup` or `enrolment` is asked on the
-- auth origin before the passkey (docs/people-prd.md §8.3). Identity renders
-- that page and may not read People's schema, so People reports the set:
-- `PUT /api/internal/tenants/<id>/signup-questions`, the whole set each time,
-- and this keeps the newest (`as_of`), the same way `module_role_report` does.
--
-- `signup_answered` holds keys, never values. The answers are forwarded on
-- `identity.account.signup_answered` and discarded; what identity remembers is
-- only that a question was asked and answered, so a returning person is not
-- asked it again.
--
-- Expand only, per CLAUDE.md: a new table, and a new column with a constant
-- default, which Postgres adds without rewriting the table.
CREATE TABLE platform.signup_question_set (
  tenant_id      uuid        PRIMARY KEY REFERENCES platform.tenant (id),
  -- The People schema version the questions were read from.
  schema_version integer     NOT NULL,
  -- `SignupQuestionSet.questions`: labels and rules, never an answer.
  questions      jsonb       NOT NULL,
  as_of          timestamptz NOT NULL,
  received_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT signup_question_set_questions_array CHECK (jsonb_typeof(questions) = 'array')
);

ALTER TABLE platform.signup_question_set ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.signup_question_set FORCE  ROW LEVEL SECURITY;
CREATE POLICY signup_question_set_tenant_isolation ON platform.signup_question_set
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE ON platform.signup_question_set TO svc_identity;

ALTER TABLE platform.account
  ADD COLUMN IF NOT EXISTS signup_answered text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN platform.account.signup_answered IS
  'Keys of the sign-up questions this account has answered. Never the values: those go to People on identity.account.signup_answered.';
