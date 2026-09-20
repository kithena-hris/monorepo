-- What somebody is called, asked on their first day and kept by identity.
--
-- Enrolment used to go straight to the passkey prompt, so the only thing this
-- service ever knew about a person was their work address — which is what the
-- prompt showed them, and `ada@acme.example` is a poor way to ask somebody to
-- confirm that an account is theirs. Onboarding now asks, and this is where the
-- answer goes.
--
-- Three parts rather than one string, matching the People module's `PersonName`
-- contract: display order belongs to a locale, not to a person, and storing the
-- formatted result throws away the only thing that lets an interface get it
-- right. `preferred_name` is null when somebody goes by their given name, which
-- is most people.
--
-- ### Why identity holds a name at all
--
-- It already holds `work_email`, `time_zone` and `employment_start` on this
-- table: the facts the sign-in ceremony and the enrolment rules need. A name is
-- the same kind of fact — it is what the WebAuthn prompt renders and what a
-- greeting uses, and neither can wait for a module that a customer may not have
-- bought.
--
-- It stops there, deliberately. A job title, a manager, a department, an
-- emergency contact and a home address are the People module's, and identity
-- holding them would give one person two records that drift apart. See
-- `docs/code-structure.md` for the boundary this is respecting rather than
-- widening.
--
-- Expand-contract: nullable, so every account enrolled before this keeps
-- working and simply has no name recorded. Nothing reads these columns and
-- requires a value.

ALTER TABLE platform.account
  ADD COLUMN IF NOT EXISTS given_name     text,
  ADD COLUMN IF NOT EXISTS family_name    text,
  ADD COLUMN IF NOT EXISTS preferred_name text;

-- The same bound the domain enforces, stated again where a second writer cannot
-- skip it. `checkName` is the rule; this is the floor under it, and the two
-- disagreeing is a bug in the rule rather than a reason to loosen the floor.
ALTER TABLE platform.account
  DROP CONSTRAINT IF EXISTS account_name_lengths;

ALTER TABLE platform.account
  ADD CONSTRAINT account_name_lengths CHECK (
    (given_name     IS NULL OR length(given_name)     BETWEEN 1 AND 100) AND
    (family_name    IS NULL OR length(family_name)    BETWEEN 1 AND 100) AND
    (preferred_name IS NULL OR length(preferred_name) BETWEEN 1 AND 100)
  );

-- A legal name is half of one and not the other, which is a row nothing should
-- be able to write. Enforced here because the two columns are set together by
-- one statement and a partial write means the form was bypassed.
ALTER TABLE platform.account
  DROP CONSTRAINT IF EXISTS account_name_complete;

ALTER TABLE platform.account
  ADD CONSTRAINT account_name_complete CHECK (
    (given_name IS NULL) = (family_name IS NULL)
  );

COMMENT ON COLUMN platform.account.given_name IS
  'Legal given name, as it appears on their identity documents.';
COMMENT ON COLUMN platform.account.family_name IS
  'Legal family name, as it appears on their identity documents.';
COMMENT ON COLUMN platform.account.preferred_name IS
  'What colleagues should call them. Null when that is their given name.';
