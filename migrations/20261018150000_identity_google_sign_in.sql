-- Signing in with Google, beside the passkey (`docs/authentication.md`, "The
-- tenant login page").
--
-- Off until a company asks for it: the button appears on its sign-in page only
-- once the back office switches it on. No list of domains goes with it, because
-- the rule needs none — identity accepts a Google account only when Google says
-- a Workspace organisation manages it (`hd`), its address is verified, and that
-- address is the person's work address here. A personal Google account opened
-- on a work address carries no `hd` and is refused.
ALTER TABLE platform.tenant
  ADD COLUMN IF NOT EXISTS google_sign_in boolean NOT NULL DEFAULT false;

-- One row per trip to Google, spent when it comes back.
--
-- The `state` parameter is the key, so the callback, the one URI registered with
-- Google, learns which company it is for without trusting anything else in the
-- URL. The PKCE verifier and the nonce stay here and never reach the browser.
-- `app_redirect` and `app_challenge` carry the phone app's sign-in through the
-- trip, checked again by the tenant app before anything is sent to them.
CREATE TABLE IF NOT EXISTS platform.google_sign_in_state (
  state         text PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES platform.tenant (id),
  -- Where to send the person back to, whatever Google answers. A label is
  -- never renamed (`amend.ts`), so holding it for ten minutes is safe.
  tenant_slug   text NOT NULL,
  verifier      text NOT NULL,
  nonce         text NOT NULL,
  app_redirect  text,
  app_challenge text,
  expires_at    timestamptz NOT NULL
);

-- Read before any tenant is known, like `webauthn_challenge`.
ALTER TABLE platform.google_sign_in_state DISABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS google_sign_in_state_expiry
  ON platform.google_sign_in_state (expires_at);

GRANT SELECT, INSERT, DELETE ON platform.google_sign_in_state TO svc_identity;
