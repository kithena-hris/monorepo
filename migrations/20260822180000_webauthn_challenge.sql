-- WebAuthn challenges, moved out of Valkey.
--
-- Not a performance change. Valkey ran as a Fly machine with no services
-- declared, which meant Fly's proxy had nothing to autostart it through: once
-- the platform stopped it, it stayed stopped, and the identity service sat
-- retrying `getaddrinfo kithena-valkey.internal` until somebody noticed. It
-- took a passkey enrolment with it, because `enrol/begin` writes the challenge
-- before the browser is ever asked for a credential — so the button waits on a
-- device that is never going to be prompted.
--
-- A challenge is a few dozen bytes that lives for a minute and is read exactly
-- once. That is well inside what Postgres does without complaint, and this
-- database is already the thing identity cannot run without. Removing Valkey
-- removes an entire second process that could be down while the first one is
-- up, which is the failure mode that actually bit.
--
-- The Valkey implementation stays in the tree behind the same port. The choice
-- is a wiring decision in `composition.ts`, not a rewrite, and a deployment
-- with a real always-on Redis should still be able to make it.

CREATE TABLE IF NOT EXISTS platform.webauthn_challenge (
  -- The challenge itself is the key. It is random and server-issued, so a
  -- client cannot invent one, and keying by it means a discoverable-credential
  -- sign-in — where nobody has said who they are yet — needs no browser state.
  challenge  text PRIMARY KEY,

  purpose    text NOT NULL,

  -- The identity a registration is for. Null when nobody has identified yet,
  -- which is every discoverable sign-in.
  subject    uuid,

  expires_at timestamptz NOT NULL,

  CONSTRAINT webauthn_challenge_purpose_known
    CHECK (purpose IN ('registration', 'authentication'))
);

-- Deliberately no row-level security, and this is the one place in the schema
-- where that needs saying out loud rather than being an oversight.
--
-- A challenge is issued before there is a principal — that is what it is for.
-- On a discoverable sign-in nobody has said who they are, so there is no
-- `app.tenant_id` for a policy to compare against, and a policy here would
-- refuse every row for the whole of the flow it is supposed to protect. The
-- same reasoning `platform.tenant` carries.
--
-- What protects a challenge is not a policy: it is that it is unguessable, it
-- expires in about a minute, and reading it destroys it.
ALTER TABLE platform.webauthn_challenge DISABLE ROW LEVEL SECURITY;

-- For the sweep below. Not on `challenge` — that is the primary key already.
CREATE INDEX IF NOT EXISTS webauthn_challenge_expiry
  ON platform.webauthn_challenge (expires_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON platform.webauthn_challenge TO svc_identity;
