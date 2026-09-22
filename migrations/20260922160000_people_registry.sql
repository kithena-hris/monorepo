-- The registry: what a tenant's employee record is made of.
--
-- Three tables and one rule between them. `people.section` and
-- `people.attribute_definition` are the draft a settings screen edits;
-- `people.schema_version` is the immutable snapshot a form renders, an API
-- validates against and a third party integrates with. Editing a definition
-- changes nothing until a version is published, which is the only way to give
-- an integrator a stable contract and an HR admin somewhere safe to
-- experiment.
--
-- Every table copies the isolation form from
-- `20260922140000_people_bootstrap.sql`: ENABLE and FORCE row level security,
-- and a policy on
-- `tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid` with
-- both USING and WITH CHECK. That comment is the pattern's home; this file is
-- the first to copy it.

-- ----------------------------------------------------------------- section --
--
-- A titled group of attributes, ordered, tenant-owned.
--
-- Sections are presentation *and* a permission grouping: a visibility rule set
-- here is the default for every attribute in it, which is how an HR admin
-- avoids setting twenty rules by hand and how a line manager avoids seeing a
-- salary by accident.
CREATE TABLE people.section (
  tenant_id   uuid NOT NULL,

  -- The stable identifier, chosen once. Lowercase, underscore-separated, and
  -- checked here as well as in the contract because a country pack, an import
  -- and a REST call all reach this table and only one of them goes through a
  -- form.
  key         text NOT NULL,

  -- Localized labels: `{ "default": "...", "translations": { "es": "..." } }`.
  -- The label is what a human sees and the key never is, which is why one is
  -- a JSONB map and the other is not.
  labels      jsonb NOT NULL,

  ord         int  NOT NULL DEFAULT 0,

  -- The default every attribute in this section inherits. A text array rather
  -- than JSONB: it is a set of enum values, and `@>` on an array is what a
  -- later "which sections can HR see" query wants.
  visibility  text[] NOT NULL DEFAULT '{}',

  -- Whether Kithena ships it, a country pack ships it, or the customer
  -- invented it. Decides what may be archived and what may only be relabelled.
  origin      text NOT NULL,

  -- Archived, not deleted. A section that disappeared would take its
  -- attributes' history with it as far as any reader is concerned.
  archived_at timestamptz,

  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (tenant_id, key),

  CONSTRAINT section_key_shape CHECK (key ~ '^[a-z][a-z0-9_]*$'),
  CONSTRAINT section_origin_known CHECK (origin IN ('core', 'country_pack', 'tenant')),
  -- A label with no default renders as a field with no name. The contract
  -- refuses it; so does the column, because an import does not go through the
  -- contract's form path.
  CONSTRAINT section_labels_have_default CHECK (labels ? 'default')
);

ALTER TABLE people.section ENABLE ROW LEVEL SECURITY;
ALTER TABLE people.section FORCE  ROW LEVEL SECURITY;
CREATE POLICY section_tenant_isolation ON people.section
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE TRIGGER section_touch_updated_at
  BEFORE UPDATE ON people.section
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

-- ---------------------------------------------------- attribute_definition --
--
-- One field: its type, its validation, who may write it, who may read it, and
-- how it is classified.
CREATE TABLE people.attribute_definition (
  tenant_id     uuid NOT NULL,
  key           text NOT NULL,
  section_key   text NOT NULL,

  labels        jsonb NOT NULL,
  description   jsonb,
  ord           int   NOT NULL DEFAULT 0,

  data_type     text  NOT NULL,
  -- Options for a select, min and max for a number, country and scheme for a
  -- national identifier. Discriminated on `kind`, which must agree with
  -- `data_type` — the contract refuses a mismatch, and the check below refuses
  -- the half of it a column can see.
  type_config   jsonb NOT NULL,
  cardinality   text  NOT NULL DEFAULT 'single',

  -- The rule, as the closed grammar in `packages/contracts/src/people`. JSONB
  -- because it is a small tree; never a user-authored expression.
  requiredness  jsonb NOT NULL,

  -- Who may write, and who may read. Separate because they genuinely differ:
  -- an employee owns their bank account and cannot see their own salary band.
  ownership     text[] NOT NULL,
  -- An empty array is meaningful and is not an oversight: voluntary
  -- self-identification is visible to nobody as an individual value,
  -- including HR and including the tenant's own administrators.
  visibility    text[] NOT NULL DEFAULT '{}',

  collect_at    text NOT NULL,

  -- The `FieldPolicy` — classification, piiKind, exportable, aiEligible and
  -- retention.
  --
  -- NOT NULL, with no default. There is no "unclassified" state, no value
  -- meaning "we will decide later", and no code path that writes a definition
  -- without one. An unclassified field is how a value reaches a log, an export
  -- and a model prompt on the same afternoon, and the redaction paths, the AI
  -- deny list, the DSAR manifest and the retention targets are all computed
  -- from this column for tenant-defined fields.
  classification        jsonb NOT NULL,
  -- Who decided. `suggested` means a model proposed it and a human accepted,
  -- which is a different fact from a human choosing unprompted — and a works
  -- council asking "who decided this field was internal" deserves the true one.
  classification_source text NOT NULL,

  effective_dated       boolean NOT NULL DEFAULT false,
  unique_scope          text    NOT NULL DEFAULT 'none',
  -- Value lives in `people.person_secret`. Never in `custom`, never in an event.
  encrypted             boolean NOT NULL DEFAULT false,
  indexed               boolean NOT NULL DEFAULT false,
  include_in_directory  boolean NOT NULL DEFAULT false,
  include_in_events     boolean NOT NULL DEFAULT false,

  origin        text NOT NULL,
  -- Hidden from forms, still exported, still in history. The honest
  -- alternative to deleting a field somebody's integration reads.
  deprecated_at timestamptz,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (tenant_id, key),

  -- Composite, so the reference cannot cross a tenant boundary. A plain
  -- `REFERENCES people.section (key)` is not even possible here, and that is
  -- the point: the tenant is half the identity of every row in this schema.
  FOREIGN KEY (tenant_id, section_key) REFERENCES people.section (tenant_id, key),

  CONSTRAINT attribute_key_shape CHECK (key ~ '^[a-z][a-z0-9_]*$'),
  CONSTRAINT attribute_labels_have_default CHECK (labels ? 'default'),
  CONSTRAINT attribute_cardinality_known CHECK (cardinality IN ('single', 'repeating')),
  CONSTRAINT attribute_origin_known CHECK (origin IN ('core', 'country_pack', 'tenant')),
  CONSTRAINT attribute_unique_scope_known CHECK (
    unique_scope IN ('none', 'tenant', 'legal_entity')
  ),
  CONSTRAINT attribute_collect_at_known CHECK (
    collect_at IN ('signup', 'enrolment', 'onboarding', 'hr_only', 'anytime')
  ),
  CONSTRAINT attribute_classification_source_known CHECK (
    classification_source IN ('human', 'suggested', 'section_default')
  ),
  -- A field nobody may write cannot be filled in.
  CONSTRAINT attribute_has_an_owner CHECK (cardinality(ownership) > 0),
  -- The policy is a policy, not an empty object somebody inserted to satisfy
  -- NOT NULL. Four keys, all of them answers.
  CONSTRAINT attribute_classification_complete CHECK (
    classification ? 'classification'
    AND classification ? 'piiKind'
    AND classification ? 'exportable'
    AND classification ? 'aiEligible'
  ),
  CONSTRAINT attribute_classification_known CHECK (
    classification ->> 'classification'
      IN ('public', 'internal', 'confidential', 'special-category')
  ),
  /*
   * The two refinements that are not negotiable, enforced again here.
   *
   * The contract refuses both and this is not redundancy: a value reaches this
   * table from a form, an import, a REST call and a country pack, and a
   * constraint is the one check none of those four can route around. Article 9
   * data never travels on an event and is never sent to a model; financial
   * data is always encrypted at rest, because a bank account in `custom` is a
   * bank account in a JSONB column, a GIN index, a replication slot and
   * whatever somebody pasted into a support ticket.
   */
  CONSTRAINT attribute_special_category_stays_put CHECK (
    classification ->> 'classification' <> 'special-category'
    OR ((classification ->> 'aiEligible')::boolean IS FALSE AND include_in_events IS FALSE)
  ),
  CONSTRAINT attribute_financial_is_encrypted CHECK (
    classification ->> 'piiKind' <> 'financial' OR encrypted IS TRUE
  ),
  -- A decrypted value with an index on it is the plaintext with an index on it.
  CONSTRAINT attribute_encrypted_stays_out_of_reach CHECK (
    encrypted IS FALSE
    OR (indexed IS FALSE AND include_in_events IS FALSE AND include_in_directory IS FALSE)
  ),
  -- Two fields naming one thing can disagree, and the disagreement renders as
  -- a dropdown over a free-text column.
  CONSTRAINT attribute_config_matches_type CHECK (type_config ->> 'kind' = data_type)
);

-- "Render this section" and "what does the directory show", which are the two
-- reads a form and a directory make on every request.
CREATE INDEX attribute_section_order_idx
  ON people.attribute_definition (tenant_id, section_key, ord);

-- The promotion candidates, for the tool that turns an `indexed` attribute into
-- a generated column. A partial index because almost nothing is marked.
CREATE INDEX attribute_indexed_idx
  ON people.attribute_definition (tenant_id)
  WHERE indexed IS TRUE;

ALTER TABLE people.attribute_definition ENABLE ROW LEVEL SECURITY;
ALTER TABLE people.attribute_definition FORCE  ROW LEVEL SECURITY;
CREATE POLICY attribute_definition_tenant_isolation ON people.attribute_definition
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE TRIGGER attribute_definition_touch_updated_at
  BEFORE UPDATE ON people.attribute_definition
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

-- ---------------------------------------------------------- schema_version --
--
-- An immutable published snapshot. Append-only, and the reason a draft exists
-- separately from a version.
--
-- "Rolling back" publishes the previous version's content as a **new** version,
-- for the same reason there are no down migrations: records were written while
-- the mistake was in force, and that window is a fact. `rolled_back_from`
-- records what was in force when somebody reverted, because "version 3 is
-- identical to version 1" and "version 3 exists because version 2 was wrong"
-- are different facts and only the second explains the support ticket.
CREATE TABLE people.schema_version (
  tenant_id        uuid NOT NULL,
  version          int  NOT NULL,

  published_at     timestamptz NOT NULL DEFAULT now(),
  -- The account that published. Null for a country pack applied by the system.
  published_by     uuid,

  -- SHA-256 over the canonical document. Content only, never the timestamp, so
  -- "has anything actually changed" has an answer.
  checksum         char(64) NOT NULL,

  -- The whole registry as published: sections and attribute definitions. A
  -- copy rather than a reference, because the definitions keep being edited
  -- and a version that changed underneath an integrator would not be a
  -- version.
  document         jsonb NOT NULL,

  rolled_back_from int,

  PRIMARY KEY (tenant_id, version),

  CONSTRAINT schema_version_positive CHECK (version > 0),
  CONSTRAINT schema_version_rollback_is_older CHECK (
    rolled_back_from IS NULL OR rolled_back_from < version
  ),
  -- A version with no fields validates every record as complete, which is
  -- worse than refusing to publish it.
  CONSTRAINT schema_version_has_content CHECK (
    jsonb_array_length(document -> 'attributes') > 0
  )
);

ALTER TABLE people.schema_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE people.schema_version FORCE  ROW LEVEL SECURITY;
CREATE POLICY schema_version_tenant_isolation ON people.schema_version
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

/*
 * Immutability, as a rule the database keeps.
 *
 * A published version is what an integrator pinned to version 3 keeps getting
 * and what a DSAR export is generated from years later. The domain freezes the
 * object; this is what stops an UPDATE from a migration, a support session or
 * a repository written in a hurry. Revision is publishing version n+1.
 */
CREATE OR REPLACE FUNCTION people.refuse_schema_version_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'people.schema_version is append-only; publish a new version instead'
    USING ERRCODE = 'restrict_violation';
END $$;

CREATE TRIGGER schema_version_is_immutable
  BEFORE UPDATE OR DELETE ON people.schema_version
  FOR EACH ROW EXECUTE FUNCTION people.refuse_schema_version_change();

-- ------------------------------------------------------------------ grants --
--
-- The service reads and writes the draft, and appends versions. No DELETE
-- anywhere: a section and an attribute are archived rather than removed, and a
-- version is append-only by the trigger above as well as by this grant.
GRANT SELECT, INSERT, UPDATE ON people.section              TO svc_people;
GRANT SELECT, INSERT, UPDATE ON people.attribute_definition TO svc_people;
GRANT SELECT, INSERT         ON people.schema_version       TO svc_people;
