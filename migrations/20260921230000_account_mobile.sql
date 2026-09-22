-- A second way to reach somebody, asked on their first day.
--
-- Onboarding already collects a name and already holds a time zone; this is the
-- third fact of the same kind. It is what an HR admin uses to verify a person
-- out of band before re-issuing access, which is the recovery story
-- `docs/authentication.md` calls the actual differentiator — an emailed reset
-- link throws away the phishing resistance the passkey was bought for, and the
-- alternative is a human who can recognise the person on the other end.
--
-- ### It is not a sign-in factor
--
-- Nothing reads this column to authenticate anybody, and nothing should. An SMS
-- code sent to a number an attacker can port is weaker than the passkey it
-- would be standing in for, and adding one would be the single change that
-- undoes the reason this system has no passwords.
--
-- ### It stops here
--
-- A job title, a manager, a department, an emergency contact and a home address
-- are the People module's. Identity holding them would give one person two
-- records that drift apart; see `docs/code-structure.md` for the boundary this
-- respects rather than widens.
--
-- Expand-contract: nullable, so every account enrolled before this keeps
-- working and simply has no number recorded. Nothing reads it and requires a
-- value.

ALTER TABLE platform.account
  ADD COLUMN IF NOT EXISTS mobile text;

-- The same bounds the domain enforces, stated again where a second writer
-- cannot skip them. `checkPersonProfile` is the rule; this is the floor under
-- it, and the two disagreeing is a bug in the rule rather than a reason to
-- loosen the floor.
--
-- The character class is deliberately permissive. Numbering plans differ by
-- country and change, so a constraint that "validates" a phone number rejects
-- real ones — this refuses what is obviously not a number and accepts the rest.
ALTER TABLE platform.account
  DROP CONSTRAINT IF EXISTS account_mobile_shape;

ALTER TABLE platform.account
  ADD CONSTRAINT account_mobile_shape CHECK (
    mobile IS NULL OR (
      length(mobile) BETWEEN 6 AND 32
      AND mobile ~ '^\+?[0-9 ().-]+$'
    )
  );

COMMENT ON COLUMN platform.account.mobile IS
  'A second channel for HR-mediated recovery. Never a sign-in factor.';
