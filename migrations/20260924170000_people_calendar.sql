-- Whose day it is: legal entities, locations and tenant settings (PEO-099).
--
-- Every "today" in People — a field required from the 1st, a retention date,
-- the daily headcount — compares a calendar date with an instant read on
-- somebody's calendar. Until now that calendar was UTC or whatever a request
-- carried, so at 01:00 in Auckland "today" was yesterday. The decision is a
-- time zone per legal entity and per location:
--
--   * a person's day is their work location's zone, else their legal
--     entity's default, else their own zone, else the tenant default;
--   * a company-wide aggregate is counted per legal entity on that entity's
--     day, and the tenant-wide figure is the sum of those.
--
-- The rule lives in `services/people/src/domain/org/calendar.ts`; these
-- tables hold what it reads. Isolation is the pattern set out in
-- 20260922140000_people_bootstrap.sql on every table: ENABLE + FORCE, one
-- policy, USING and WITH CHECK.
--
-- Expand only. `people.person.legal_entity_id` and `location_id` are not given
-- foreign keys here: rows already hold ids nothing was checking, and an FK
-- added over them is a failed deploy. The resolver treats an id it cannot find
-- as absent and falls back, which is the answer an FK would have forced anyway.

-- ---------------------------------------------------------- tenant_settings --
--
-- One row per tenant, created on first need. The two settings that are the
-- tenant's rather than an entity's: the zone of last resort, and the cohort
-- minimum for special-category aggregates (§6.7, §16.1).
--
-- **The cohort minimum is never lowerable**, and that is enforced here as
-- well as in the domain: a CHECK for the floor of ten, and a trigger refusing
-- any UPDATE that lowers it. A minimum that could be lowered for an afternoon
-- is a minimum that could be lowered for one query, and the published
-- breakdowns would then be re-read under it.
CREATE TABLE people.tenant_settings (
  tenant_id         uuid PRIMARY KEY,
  -- Shape only; the application validates against the IANA database via Intl,
  -- which a CHECK cannot reach.
  default_time_zone text NOT NULL DEFAULT 'Etc/UTC',
  cohort_minimum    int  NOT NULL DEFAULT 10,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT tenant_settings_zone_shape
    CHECK (default_time_zone ~ '^[A-Za-z]+(/[A-Za-z0-9_+-]+)*$'),
  CONSTRAINT tenant_settings_cohort_floor CHECK (cohort_minimum >= 10)
);

CREATE OR REPLACE FUNCTION people.refuse_cohort_minimum_lowered()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.cohort_minimum < OLD.cohort_minimum THEN
    RAISE EXCEPTION 'the cohort minimum can be raised, never lowered (% to %)',
      OLD.cohort_minimum, NEW.cohort_minimum
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER tenant_settings_cohort_minimum_never_lowered
  BEFORE UPDATE ON people.tenant_settings
  FOR EACH ROW EXECUTE FUNCTION people.refuse_cohort_minimum_lowered();

CREATE TRIGGER tenant_settings_touch_updated_at
  BEFORE UPDATE ON people.tenant_settings
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

ALTER TABLE people.tenant_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE people.tenant_settings FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_settings_tenant_isolation ON people.tenant_settings
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- No DELETE: settings are replaced, never forgotten.
GRANT SELECT, INSERT, UPDATE ON people.tenant_settings TO svc_people;

-- ------------------------------------------------------------- legal_entity --
--
-- The employer of record. A country (which country pack applies, whose
-- numbering) and a default zone (whose day its aggregates are counted on).
-- The default zone is configuration, changed when recorded; a location's zone
-- is the effective-dated fact, below.
CREATE TABLE people.legal_entity (
  tenant_id   uuid NOT NULL,
  id          uuid NOT NULL,
  name        text NOT NULL,
  country     char(2) NOT NULL,
  time_zone   text NOT NULL,
  -- Hidden from pickers, still resolvable: people may still point at it.
  archived_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (tenant_id, id),
  CONSTRAINT legal_entity_name_present CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  CONSTRAINT legal_entity_country_shape CHECK (country ~ '^[A-Z]{2}$'),
  CONSTRAINT legal_entity_zone_shape CHECK (time_zone ~ '^[A-Za-z]+(/[A-Za-z0-9_+-]+)*$')
);

CREATE TRIGGER legal_entity_touch_updated_at
  BEFORE UPDATE ON people.legal_entity
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

ALTER TABLE people.legal_entity ENABLE ROW LEVEL SECURITY;
ALTER TABLE people.legal_entity FORCE  ROW LEVEL SECURITY;
CREATE POLICY legal_entity_tenant_isolation ON people.legal_entity
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- No DELETE: archived, because a person's history names it.
GRANT SELECT, INSERT, UPDATE ON people.legal_entity TO svc_people;

-- ----------------------------------------------------------------- location --
CREATE TABLE people.location (
  tenant_id       uuid NOT NULL,
  id              uuid NOT NULL,
  legal_entity_id uuid NOT NULL,
  name            text NOT NULL,
  country         char(2) NOT NULL,
  archived_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES people.legal_entity (tenant_id, id),
  CONSTRAINT location_name_present CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  CONSTRAINT location_country_shape CHECK (country ~ '^[A-Z]{2}$')
);

CREATE TRIGGER location_touch_updated_at
  BEFORE UPDATE ON people.location
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

ALTER TABLE people.location ENABLE ROW LEVEL SECURITY;
ALTER TABLE people.location FORCE  ROW LEVEL SECURITY;
CREATE POLICY location_tenant_isolation ON people.location
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE ON people.location TO svc_people;

-- ------------------------------------------------------------ location_zone --
--
-- A location's zone, effective-dated and append-only, the way person history
-- is: a change is a new row from a date, a correction is a new row carrying
-- `supersedes`. An office that moves to the Canaries on 1 April is on Canary
-- time from that midnight, and "which day was the 31st for them" stays
-- answerable after it has.
CREATE TABLE people.location_zone (
  tenant_id      uuid NOT NULL,
  id             uuid NOT NULL,
  location_id    uuid NOT NULL,
  effective_from date NOT NULL,
  time_zone      text NOT NULL,
  supersedes     uuid,
  recorded_at    timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, location_id) REFERENCES people.location (tenant_id, id),
  FOREIGN KEY (tenant_id, supersedes) REFERENCES people.location_zone (tenant_id, id),
  -- A row is corrected once; a second correction supersedes the first.
  CONSTRAINT location_zone_superseded_once UNIQUE (tenant_id, supersedes),
  CONSTRAINT location_zone_shape CHECK (time_zone ~ '^[A-Za-z]+(/[A-Za-z0-9_+-]+)*$')
);

CREATE INDEX location_zone_read_idx ON people.location_zone (tenant_id, location_id, effective_from);

ALTER TABLE people.location_zone ENABLE ROW LEVEL SECURITY;
ALTER TABLE people.location_zone FORCE  ROW LEVEL SECURITY;
CREATE POLICY location_zone_tenant_isolation ON people.location_zone
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- Append-only by grant: no UPDATE, no DELETE.
GRANT SELECT, INSERT ON people.location_zone TO svc_people;

-- ----------------------------------------------------- schema_version.evaluated_at --
--
-- The instant a publish's impact preview evaluated `requiredFrom` at.
-- `evaluated_on` (PEO-026) holds one date, which was right while there was one
-- calendar per request. With a calendar per person, the preview reads each
-- person's day off one instant, and the recompute has to read the same
-- instant to reach the same count. Nullable: older versions keep their date.
ALTER TABLE people.schema_version ADD COLUMN evaluated_at timestamptz;
