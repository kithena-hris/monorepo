-- A sealed value with a history: pay (People PRD Appendix A, base salary
-- effective-dated). Each dated change keeps its own ciphertext here, by the
-- history row it belongs to; `person_attribute_history.value` stays null for
-- it, as for every sealed value. `person_secret` keeps the one in force today,
-- and now says which dated change that is, so a change dated ahead comes into
-- force from its own sealed copy without a plaintext ever being stored.
--
-- Expand only: one new table and one nullable column.

CREATE TABLE people.person_secret_dated (
  tenant_id     uuid  NOT NULL,
  history_id    uuid  NOT NULL,
  person_id     uuid  NOT NULL,
  attribute_key text  NOT NULL,

  ciphertext    bytea NOT NULL,
  key_id        text  NOT NULL,
  last4         text,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (tenant_id, history_id),
  FOREIGN KEY (tenant_id, person_id) REFERENCES people.person (tenant_id, id),

  CONSTRAINT secret_dated_key_shape CHECK (attribute_key ~ '^[a-z][a-z0-9_]*$'),
  CONSTRAINT secret_dated_last4_is_four CHECK (last4 IS NULL OR length(last4) <= 4)
);

CREATE INDEX person_secret_dated_person_idx
  ON people.person_secret_dated (tenant_id, person_id, attribute_key);

ALTER TABLE people.person_secret_dated ENABLE ROW LEVEL SECURITY;
ALTER TABLE people.person_secret_dated FORCE  ROW LEVEL SECURITY;
CREATE POLICY person_secret_dated_tenant_isolation ON people.person_secret_dated
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE TRIGGER person_secret_dated_touch_updated_at
  BEFORE UPDATE ON people.person_secret_dated
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

-- Re-wrapped by a rotation, deleted with the person by retention.
GRANT SELECT, INSERT, UPDATE, DELETE ON people.person_secret_dated TO svc_people;

-- Which dated change the value in force is; null for a sealed value with no history.
ALTER TABLE people.person_secret ADD COLUMN history_id uuid;
