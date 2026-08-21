-- Tenant registry: the table the hostname resolves against.
--
-- `companyName.app.kithena.com` arrives as a Host header on every request, and
-- something has to turn `companyName` into the uuid that row-level security
-- scopes by. This is that something, and it is the one table read before a
-- tenant is known, so it deliberately carries no row-level security of its own.

CREATE SCHEMA IF NOT EXISTS platform;

CREATE TABLE platform.tenant (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The subdomain label, lower case. Checked here as well as in the
  -- application: the application is one of four transports and the constraint
  -- is the only thing every write passes through.
  --
  -- 3..63 characters because 63 is the DNS label limit and anything shorter
  -- than 3 is worth keeping back for our own use. No leading or trailing
  -- hyphen, no consecutive hyphens: all three are either invalid in a hostname
  -- or a homograph waiting to be registered.
  slug         text NOT NULL,

  display_name text NOT NULL,

  -- Soft states only. A tenant is never deleted while it holds employment
  -- records: a labour inspector can ask for them years after a customer
  -- leaves, and retention is a policy decision rather than a DELETE.
  status       text NOT NULL DEFAULT 'active',

  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT tenant_slug_shape CHECK (
    slug ~ '^[a-z0-9]([a-z0-9-]{1,61}[a-z0-9])$' AND slug !~ '--'
  ),
  CONSTRAINT tenant_status_known CHECK (
    status IN ('active', 'suspended', 'closed')
  )
);

-- Case-insensitive uniqueness, enforced by storing lower case and indexing it.
-- `Acme` and `acme` are the same hostname to DNS, so they must be the same
-- tenant here or the second signup silently shadows the first.
CREATE UNIQUE INDEX tenant_slug_key ON platform.tenant (slug);

-- Reserved labels, as data rather than as a list in application code. The
-- application will check this too, but a check that only exists in one of four
-- transports is not a constraint. Held in its own table so adding a reserved
-- word later is a migration rather than a deploy of every service.
CREATE TABLE platform.reserved_slug (
  slug   text PRIMARY KEY,
  reason text NOT NULL
);

INSERT INTO platform.reserved_slug (slug, reason) VALUES
  ('www',      'the apex site'),
  ('app',      'the tenant host suffix itself'),
  ('staging',  'the staging host suffix'),
  ('api',      'reserved for a public API'),
  ('admin',    'the internal admin surface'),
  ('static',   'reserved for asset hosting'),
  ('assets',   'reserved for asset hosting'),
  ('cdn',      'reserved for asset hosting'),
  ('mail',     'mail routing'),
  ('smtp',     'mail routing'),
  ('imap',     'mail routing'),
  ('design',   'the Reach documentation site'),
  ('storybook','the Reach storybook site'),
  ('status',   'reserved for a status page'),
  ('docs',     'reserved for documentation'),
  ('support',  'reserved for support'),
  ('billing',  'reserved for billing'),
  ('auth',     'reserved for the identity provider'),
  ('login',    'reserved for the identity provider'),
  ('internal', 'reserved');

-- A slug cannot be taken if it is reserved. A trigger rather than a foreign
-- key, because the relationship is an absence rather than a reference.
CREATE OR REPLACE FUNCTION platform.tenant_slug_not_reserved()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM platform.reserved_slug WHERE slug = NEW.slug) THEN
    RAISE EXCEPTION 'slug % is reserved', NEW.slug
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tenant_slug_not_reserved
  BEFORE INSERT OR UPDATE OF slug ON platform.tenant
  FOR EACH ROW EXECUTE FUNCTION platform.tenant_slug_not_reserved();

CREATE OR REPLACE FUNCTION platform.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER tenant_touch_updated_at
  BEFORE UPDATE ON platform.tenant
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();
