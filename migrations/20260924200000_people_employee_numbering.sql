-- Employee numbering per legal entity (PRD §7, §9.4; PEO-101).
--
-- One row per legal entity that numbers its people: a prefix, a minimum width,
-- and the next number to hand out. An entity with no row does not number;
-- a hire there leaves the employee number to whoever types one.
--
-- **Gap-free under concurrency.** A hire allocates with
--   UPDATE ... SET next_value = next_value + 1 ... RETURNING next_value - 1
-- inside its own transaction. The row lock queues two hires in one entity, and
-- a hire that rolls back rolls its number back with it. A Postgres sequence is
-- the wrong tool for exactly that reason: `nextval` is never rolled back, so
-- every refused hire would leave a hole in the register.
--
-- **Unique per legal entity** needs nothing new: `person_employee_number_key`
-- (20260922170000) already makes a number unique in the whole tenant, which
-- is stricter, and an import matches people on it. The write path claims the
-- number tenant-wide through the unique-claims mechanism first, so a clash is
-- a refusal the caller can show rather than a 23505, and a hire skips a
-- number somebody already holds.
--
-- Expand only: a new table, nothing existing changes.

CREATE TABLE people.employee_numbering (
  tenant_id       uuid     NOT NULL,
  legal_entity_id uuid     NOT NULL,
  prefix          text     NOT NULL DEFAULT '',
  digits          smallint NOT NULL,
  next_value      bigint   NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (tenant_id, legal_entity_id),
  FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES people.legal_entity (tenant_id, id),
  -- The domain says the same; this is for any path that skips it.
  CONSTRAINT employee_numbering_prefix_shape CHECK (prefix ~ '^[A-Za-z0-9-]{0,10}$'),
  CONSTRAINT employee_numbering_digits_range CHECK (digits BETWEEN 1 AND 12),
  CONSTRAINT employee_numbering_next_positive CHECK (next_value >= 1)
);

CREATE TRIGGER employee_numbering_touch_updated_at
  BEFORE UPDATE ON people.employee_numbering
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

ALTER TABLE people.employee_numbering ENABLE ROW LEVEL SECURITY;
ALTER TABLE people.employee_numbering FORCE  ROW LEVEL SECURITY;
CREATE POLICY employee_numbering_tenant_isolation ON people.employee_numbering
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- No DELETE: a scheme is changed, never forgotten, or its numbers could be
-- handed out a second time.
GRANT SELECT, INSERT, UPDATE ON people.employee_numbering TO svc_people;
