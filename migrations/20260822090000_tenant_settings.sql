-- What a company looks like, and how its people are allowed to sign in.
--
-- Both are set by the back-office when a customer is created and by their own
-- HR admin afterwards. Both are read before anybody has authenticated, which is
-- what shapes where they live.

-- ------------------------------------------------------------------ branding
--
-- On `platform.tenant` rather than in a table of its own.
--
-- docs/auth-administration.md proposed `platform.tenant_branding`, and grouping
-- would read better. This is the row the login page reads before a session
-- exists, on every cold visit, and a join to render a logo is a join on the
-- coldest path in the product. Three nullable columns cost nothing; a second
-- table costs a query.
ALTER TABLE platform.tenant
  -- Where the mark is served from. Never the mark itself: an SVG in a column is
  -- an SVG that gets rendered, and SVG carries script. Uploads are rasterised
  -- and served from object storage, so what lands here is a URL and the login
  -- page never interprets bytes a customer supplied.
  ADD COLUMN logo_url text,

  -- A single accent, as an OKLCH triple that Reach's `--reach-color-accent` can
  -- take directly. Not a whole palette: a customer choosing eleven colours is a
  -- customer choosing a contrast failure, and the design system's ramp is what
  -- keeps the login page readable.
  ADD COLUMN accent_color text,

  -- Whether the login page may say whose it is.
  --
  -- `apps/web/src/lib/tenant.ts` refuses to distinguish an unknown company from
  -- a suspended one precisely so that probing slugs cannot confirm who is a
  -- customer. Putting a logo on the login page publishes exactly that.
  --
  -- Defaulting to true because most customers treat it as a logo on our website
  -- and want the branded page; the flag exists for the ones in an acquisition or
  -- a regulated matter, who get a neutral page by setting it rather than by
  -- nobody having thought about it.
  ADD COLUMN branding_public boolean NOT NULL DEFAULT true;

ALTER TABLE platform.tenant
  ADD CONSTRAINT tenant_accent_shape CHECK (
    accent_color IS NULL OR accent_color ~ '^oklch\([0-9. ]+\)$'
  );

-- --------------------------------------------------------------- auth policy
--
-- Which methods a company's people may use. One row per tenant, absent meaning
-- the defaults below.
CREATE TABLE platform.tenant_auth_policy (
  tenant_id uuid PRIMARY KEY REFERENCES platform.tenant (id) ON DELETE CASCADE,

  -- Three states rather than a boolean, borrowed from Content Security Policy.
  -- `encourage` is what makes a passwordless migration survivable: it offers the
  -- method and counts adoption without locking out whoever was on holiday.
  passkey     text NOT NULL DEFAULT 'require',
  oidc_google text NOT NULL DEFAULT 'off',
  password    text NOT NULL DEFAULT 'off',
  mobile_otp  text NOT NULL DEFAULT 'off',

  session_limit  smallint NOT NULL DEFAULT 4,

  -- `on_approval` by default. A standing toggle that has been on since
  -- onboarding is a toggle nobody has thought about since, and it will be on at
  -- the moment it matters.
  support_access text NOT NULL DEFAULT 'on_approval',

  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT auth_policy_modes_known CHECK (
    passkey     IN ('off', 'encourage', 'require') AND
    oidc_google IN ('off', 'encourage', 'require') AND
    password    IN ('off', 'encourage', 'require') AND
    mobile_otp  IN ('off', 'encourage', 'require')
  ),
  CONSTRAINT auth_policy_support_known CHECK (
    support_access IN ('always', 'on_approval', 'never')
  ),
  CONSTRAINT auth_policy_session_limit_sane CHECK (session_limit BETWEEN 1 AND 16),

  -- The floor, in the database.
  --
  -- Password-only login is AAL1, and SP 800-63B-4 requires an AAL2 verifier to
  -- offer at least one phishing-resistant option. GDPR Article 32 binds the
  -- processor as well as the controller, so "the customer chose that setting" is
  -- not a defence worth testing on a setting we built and offered.
  --
  -- Expressed here as well as in the domain because the settings screen is one
  -- transport of four, and a rule that lives in a form validator is a rule the
  -- REST facade, the SCIM adapter and a support script all ignore.
  CONSTRAINT auth_policy_has_a_phishing_resistant_option CHECK (
    passkey <> 'off' OR oidc_google <> 'off'
  )
);

ALTER TABLE platform.tenant_auth_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.tenant_auth_policy FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_auth_policy_isolation ON platform.tenant_auth_policy
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE TRIGGER tenant_auth_policy_touch_updated_at
  BEFORE UPDATE ON platform.tenant_auth_policy
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();
