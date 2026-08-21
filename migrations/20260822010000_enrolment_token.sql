-- Enrolment tokens: how a first passkey comes to exist.
--
-- This is the weakest link in the whole design and it is worth saying why
-- plainly. Everything after enrolment is phishing-resistant; the moment a
-- person first proves who they are is a link somebody was sent. NIST SP
-- 800-63B-4 deprecates email OTP outright and downgrades SMS, so an emailed
-- link on its own is not merely weak — it is outside the standard the rest of
-- this design is built to.
--
-- The answer is not a stronger link. It is a second channel the employer
-- already has and an attacker does not: a code handed over in person on a first
-- day, or a value the employment record already holds. `second_channel` records
-- which was used, so the claim is checkable after the fact rather than assumed.

CREATE TABLE platform.enrolment_token (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES platform.tenant (id),
  account_id uuid NOT NULL REFERENCES platform.account (id) ON DELETE CASCADE,

  -- The SHA-256 of the token, never the token.
  --
  -- A database backup, a replica, a support query or a leaked dump must not
  -- yield anything usable. Plain SHA-256 rather than a password hash on
  -- purpose: this is 256 bits of `randomBytes`, not something a human chose, so
  -- there is no dictionary to slow down and a work factor would only cost
  -- latency on every presentation.
  token_hash bytea NOT NULL,

  -- Which second channel was satisfied. An enum, not free text: a reason
  -- someone types is a reason that eventually holds a diagnosis.
  second_channel text NOT NULL,

  -- 72 hours. Long enough to survive a weekend and a first day that moved;
  -- short enough that a link found in a mailbox months later is inert.
  expires_at  timestamptz NOT NULL,

  -- Single use, and this column is how. Consumption is a conditional UPDATE
  -- that only matches while it is NULL, so two requests presenting the same
  -- token see exactly one success between them. Checking then updating would
  -- leave a window in which both pass.
  consumed_at timestamptz,

  created_at  timestamptz NOT NULL DEFAULT now(),
  -- Who issued it. For the audit trail HR sees, and for recovery, where the
  -- point is that a person other than the account holder authorised this.
  issued_by   uuid REFERENCES platform.account (id),

  CONSTRAINT enrolment_second_channel_known CHECK (
    second_channel IN ('in_person', 'known_value')
  )
);

-- The lookup path. Unique, because two accounts sharing a token hash would mean
-- either a collision or a bug, and both should fail loudly at the write.
CREATE UNIQUE INDEX enrolment_token_hash_key ON platform.enrolment_token (token_hash);

-- One live token per account.
--
-- Re-issuing invalidates whatever came before rather than adding to it.
-- Without this, a person who asked for three links has three usable ones, and
-- the two they did not use are two more chances for somebody else.
CREATE UNIQUE INDEX enrolment_token_live_key
  ON platform.enrolment_token (account_id)
  WHERE consumed_at IS NULL;

ALTER TABLE platform.enrolment_token ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.enrolment_token FORCE  ROW LEVEL SECURITY;
CREATE POLICY enrolment_token_tenant_isolation ON platform.enrolment_token
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
