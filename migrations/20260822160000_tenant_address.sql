-- A company's registered address, its theme, and a second image.
--
-- Expand only, per CLAUDE.md: every column is nullable and nothing is dropped.
-- The rows that exist were created before there was an address to ask for, and
-- a NOT NULL here would mean either inventing an address for them or failing
-- the migration. They stay null until somebody fills them in.

-- The registered address, in parts rather than as one text blob.
--
-- Separate columns because this address reaches a payslip, a labour inspector
-- and a tax filing, and each of those wants a different piece of it. Re-parsing
-- a blob to find the province is how a filing goes to the wrong tax office.
--
-- Not a separate `platform.tenant_address` table: a tenant has exactly one
-- registered address, the lifetimes are identical, and a one-to-one join buys
-- nothing but a join. A second address — trading, billing, a site — would be a
-- different concept and would get its own table with its own type column.
ALTER TABLE platform.tenant
  ADD COLUMN IF NOT EXISTS address_country     text,
  ADD COLUMN IF NOT EXISTS address_line1       text,
  ADD COLUMN IF NOT EXISTS address_line2       text,
  ADD COLUMN IF NOT EXISTS address_city        text,
  ADD COLUMN IF NOT EXISTS address_subdivision text,
  ADD COLUMN IF NOT EXISTS address_postcode    text;

-- ISO 3166-1 alpha-2, upper case. The application checks the code against a
-- list of countries whose subdivision and postcode rules somebody has actually
-- verified; this only says the column holds something shaped like a country
-- code, which is the part a constraint can know without that list.
--
-- NOT VALID, then validated separately: on a large table the first statement
-- takes a brief ACCESS EXCLUSIVE lock and the scan happens afterwards under a
-- weaker one. This table is small today and will not always be.
ALTER TABLE platform.tenant
  ADD CONSTRAINT tenant_address_country_shape
  CHECK (address_country IS NULL OR address_country ~ '^[A-Z]{2}$') NOT VALID;

ALTER TABLE platform.tenant VALIDATE CONSTRAINT tenant_address_country_shape;

-- An address is all-or-nothing. A row carrying a city and no country is not a
-- partially filled form — it is a row nothing can render, export or file, and
-- the wizard has no way to produce one. Written as a comparison of two counts
-- so adding a seventh part later cannot silently escape the rule.
ALTER TABLE platform.tenant
  ADD CONSTRAINT tenant_address_all_or_nothing
  CHECK (
    (address_country IS NULL)::int
    + (address_line1 IS NULL)::int
    + (address_city IS NULL)::int
    IN (0, 3)
  ) NOT VALID;

ALTER TABLE platform.tenant VALIDATE CONSTRAINT tenant_address_all_or_nothing;

-- The larger company image, distinct from the mark in `logo_url`.
--
-- Two images because they are shown at two sizes for two reasons: `logo_url` is
-- the mark that sits next to a company name in a list, and this is the picture
-- filling the left half of that company's login page. One image cannot be both
-- — a wordmark scaled to half a screen looks like a mistake, and a photograph
-- shrunk to 24px is a smudge.
ALTER TABLE platform.tenant
  ADD COLUMN IF NOT EXISTS cover_image_url text;

-- The chosen theme, stored as the preset's id rather than its colour.
--
-- `accent_color` stays for now and is deliberately not dropped: expand-contract
-- means the old code reading it keeps working until it is deployed away. It
-- becomes dead once nothing reads it, and a later migration removes it.
ALTER TABLE platform.tenant
  ADD COLUMN IF NOT EXISTS theme_id text;

COMMENT ON COLUMN platform.tenant.accent_color IS
  'Superseded by theme_id. Retained until nothing reads it; drop in a later migration.';
