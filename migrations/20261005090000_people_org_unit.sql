-- The company's org units: departments and teams, as a tree.
--
-- `people.person.org_unit_id` has pointed at nothing since 20260922170000,
-- so a field of the org unit type offered nothing to choose. This is the list
-- it chooses from, managed in Settings › Organisation › Org units beside
-- legal entities and locations, and built the way `people.location` is: a
-- name, archived rather than deleted (people and their history still point
-- at it), isolated by the pattern in 20260922140000_people_bootstrap.sql.
--
-- The rules live in `services/people/src/domain/org/org-unit.ts`. The one a
-- race can break — two administrators adding "Platform" under Engineering at
-- once — is held here too: a name is unique among live siblings, the top
-- level counting as one parent (NULLS NOT DISTINCT).
--
-- Expand only. `person.org_unit_id` gets no foreign key, for the reason the
-- calendar migration gives for `location_id`: rows already hold ids nothing
-- checked, and an id People cannot find is shown as nothing.
CREATE TABLE people.org_unit (
  tenant_id   uuid NOT NULL,
  id          uuid NOT NULL,
  name        text NOT NULL,
  parent_id   uuid,
  archived_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, parent_id) REFERENCES people.org_unit (tenant_id, id),
  CONSTRAINT org_unit_name_present CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  CONSTRAINT org_unit_not_own_parent CHECK (parent_id IS DISTINCT FROM id)
);

CREATE UNIQUE INDEX org_unit_live_sibling_name
  ON people.org_unit (tenant_id, parent_id, lower(name)) NULLS NOT DISTINCT
  WHERE archived_at IS NULL;

CREATE TRIGGER org_unit_touch_updated_at
  BEFORE UPDATE ON people.org_unit
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

ALTER TABLE people.org_unit ENABLE ROW LEVEL SECURITY;
ALTER TABLE people.org_unit FORCE  ROW LEVEL SECURITY;
CREATE POLICY org_unit_tenant_isolation ON people.org_unit
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- No DELETE: archived, because a person's history names it.
GRANT SELECT, INSERT, UPDATE ON people.org_unit TO svc_people;
