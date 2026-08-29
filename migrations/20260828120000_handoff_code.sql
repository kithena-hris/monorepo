-- The auth origin signs somebody in; the tenant origin has to end up holding
-- the session cookie. This table is the thing that crosses between them.
--
-- Two hostnames are involved and that is the whole problem. `__Host-ksession`
-- is set on `acme.app.kithena.com` and the prefix forbids a `Domain` attribute,
-- so `auth.app.kithena.com` cannot set it — not by configuration, by browser
-- rule. The auth origin can verify a passkey and create a session and then has
-- no way to hand it over.
--
-- So it hands over a *code* instead: in the URL, useless on its own, redeemed
-- once over a back channel the browser is not part of. This is the handoff in
-- `docs/authentication.md`, reduced to the shape this system needs.
--
-- Deliberately not PKCE, and that is worth stating because the doc names it.
-- PKCE binds an authorization request to a token request made by *the same*
-- client holding the verifier. Here the two halves are different servers — the
-- auth origin issues, the tenant app redeems — so there is no single client to
-- bind and a verifier would have to travel alongside the code it protects,
-- which protects nothing. What stands in for it is below: single use, sixty
-- seconds, hashed at rest, and bound to the tenant that may redeem it.

CREATE TABLE platform.handoff_code (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES platform.tenant (id),

  -- The SHA-256 of the code, never the code.
  --
  -- Same reasoning as `enrolment_token.token_hash`: 256 bits of `randomBytes`
  -- has no dictionary to slow down, so a password hash would buy nothing and
  -- cost latency. What this buys is that a backup, a replica or a support query
  -- yields nothing that can be redeemed.
  code_hash  bytea NOT NULL,

  -- The session the tenant app will be given. Already created and already
  -- valid — this table hands over a reference to it, it does not authorise
  -- anything on its own.
  session_id uuid NOT NULL REFERENCES platform.session (id) ON DELETE CASCADE,

  -- Sixty seconds. This is a redirect, not a link somebody keeps: the browser
  -- follows it immediately or something went wrong. Long enough for a slow
  -- device and a slow network, short enough that a code left in history,
  -- a referrer header or a proxy log is inert by the time anybody reads it.
  expires_at timestamptz NOT NULL,

  -- Single use, and this column is how. Redemption is a conditional UPDATE that
  -- only matches while this is NULL, so two requests presenting the same code
  -- see exactly one success between them. Checking and then updating would
  -- leave a window where both pass.
  redeemed_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now()
);

-- The lookup path. Unique, because two rows sharing a code hash would mean
-- either a collision or a bug, and both should fail loudly at the write.
CREATE UNIQUE INDEX handoff_code_hash_key ON platform.handoff_code (code_hash);

-- Expired and redeemed rows are dead weight on the only query that reads this
-- table. A partial index keeps it to the live ones.
CREATE INDEX handoff_code_live_idx
  ON platform.handoff_code (expires_at)
  WHERE redeemed_at IS NULL;

ALTER TABLE platform.handoff_code ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.handoff_code FORCE  ROW LEVEL SECURITY;
CREATE POLICY handoff_code_tenant_isolation ON platform.handoff_code
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON platform.handoff_code TO svc_identity;
