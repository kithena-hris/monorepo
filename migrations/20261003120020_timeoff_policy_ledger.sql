-- Leave types, versioned policies and the balance ledger (PRD §6, §7.1, TOF-030).
--
-- Amounts are `numeric(9,3)`: three places is the `DayAmount` contract's
-- spelling and Postgres prints it back identically, so one value has one
-- spelling end to end. Days or hours, in the leave type's unit; never a float.

-- -------------------------------------------------------------- leave_type --
CREATE TABLE timeoff.leave_type (
  tenant_id                uuid NOT NULL,
  -- Immutable: a ledger row, an export header and somebody's integration hold it.
  key                      text NOT NULL,
  -- `LocalizedString`.
  name                     jsonb NOT NULL,
  category                 text NOT NULL,
  color_token              text NOT NULL,
  icon                     text NOT NULL,
  unit                     text NOT NULL DEFAULT 'day',
  tracked                  boolean NOT NULL,
  paid                     text NOT NULL,
  -- Null is the tenant's default rule. Constrained in the approval migration.
  approval_rule_key        text,
  visibility               text NOT NULL,
  requires_note_after_days integer,
  -- `TimeOffPredicate`; null is everybody.
  applies_to               jsonb,
  -- Pre-filled by a country pack: hidden, never deleted.
  statutory                boolean NOT NULL DEFAULT false,
  hidden_at                timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (tenant_id, key),

  CONSTRAINT leave_type_key_shape CHECK (key ~ '^[a-z][a-z0-9_]*$' AND length(key) <= 64),
  CONSTRAINT leave_type_category_known CHECK (
    category IN ('annual_leave', 'sick_leave', 'parental_leave', 'unpaid_leave', 'other')
  ),
  CONSTRAINT leave_type_unit_known CHECK (unit IN ('day', 'hour')),
  CONSTRAINT leave_type_paid_known CHECK (paid IN ('paid', 'unpaid', 'statutory')),
  CONSTRAINT leave_type_visibility_known CHECK (visibility IN ('type', 'off_only')),
  CONSTRAINT leave_type_note_after_positive CHECK (
    requires_note_after_days IS NULL OR requires_note_after_days >= 1
  ),
  CONSTRAINT leave_type_name_is_an_object CHECK (jsonb_typeof(name) = 'object')
);

ALTER TABLE timeoff.leave_type ENABLE ROW LEVEL SECURITY;
ALTER TABLE timeoff.leave_type FORCE  ROW LEVEL SECURITY;
CREATE POLICY leave_type_tenant_isolation ON timeoff.leave_type
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE TRIGGER leave_type_touch_updated_at
  BEFORE UPDATE ON timeoff.leave_type
  FOR EACH ROW EXECUTE FUNCTION timeoff.touch_updated_at();

-- ------------------------------------------------------------------ policy --
CREATE TABLE timeoff.policy (
  tenant_id      uuid NOT NULL,
  id             uuid NOT NULL,
  -- A policy stays with the leave type it was made for.
  leave_type_key text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, leave_type_key) REFERENCES timeoff.leave_type (tenant_id, key)
);

CREATE INDEX policy_leave_type_idx ON timeoff.policy (tenant_id, leave_type_key);

ALTER TABLE timeoff.policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE timeoff.policy FORCE  ROW LEVEL SECURITY;
CREATE POLICY policy_tenant_isolation ON timeoff.policy
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- ---------------------------------------------------------- policy_version --
--
-- A published version is history: ledger entries name it and a re-fold must
-- reproduce them. So the draft is edited in place and published by an
-- UPDATE, and from then on the row is refused any change at all.
CREATE TABLE timeoff.policy_version (
  tenant_id      uuid NOT NULL,
  policy_id      uuid NOT NULL,
  version        integer NOT NULL,
  status         text NOT NULL DEFAULT 'draft',
  -- `PolicyDefinition`, whole. Read and written as one document by the
  -- aggregate; nothing queries inside it.
  definition     jsonb NOT NULL,
  effective_from date,
  published_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (tenant_id, policy_id, version),
  FOREIGN KEY (tenant_id, policy_id) REFERENCES timeoff.policy (tenant_id, id),

  CONSTRAINT policy_version_positive CHECK (version >= 1),
  CONSTRAINT policy_version_status_known CHECK (status IN ('draft', 'published')),
  CONSTRAINT policy_version_published_has_date CHECK (
    (status = 'published') = (effective_from IS NOT NULL AND published_at IS NOT NULL)
  ),
  CONSTRAINT policy_version_definition_is_an_object CHECK (jsonb_typeof(definition) = 'object')
);

-- One draft at a time: revising a published policy starts the next version.
CREATE UNIQUE INDEX policy_version_one_draft
  ON timeoff.policy_version (tenant_id, policy_id)
  WHERE status = 'draft';

ALTER TABLE timeoff.policy_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE timeoff.policy_version FORCE  ROW LEVEL SECURITY;
CREATE POLICY policy_version_tenant_isolation ON timeoff.policy_version
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE OR REPLACE FUNCTION timeoff.refuse_published_policy_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'published' THEN
    RAISE EXCEPTION 'a published policy version never changes; revise it into the next version'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;

CREATE TRIGGER policy_version_published_is_fixed
  BEFORE UPDATE OR DELETE ON timeoff.policy_version
  FOR EACH ROW EXECUTE FUNCTION timeoff.refuse_published_policy_change();

-- ------------------------------------------------------------ ledger_entry --
--
-- Append-only. A correction is a new entry naming the one it `supersedes`;
-- every balance on every screen is a fold over these rows (§7.1).
CREATE TABLE timeoff.ledger_entry (
  tenant_id      uuid NOT NULL,
  -- UUIDv7, minted by the domain.
  id             uuid NOT NULL,
  person_id      uuid NOT NULL,
  leave_type_key text NOT NULL,
  kind           text NOT NULL,
  -- Signed, in the leave type's unit.
  amount         numeric(9,3) NOT NULL,
  unit           text NOT NULL,
  -- The domain date it counts from; `occurred_at` is when it was recorded.
  effective_on   date NOT NULL,
  occurred_at    timestamptz NOT NULL,
  -- The policy version that produced it; null for a booking or an adjustment.
  policy_version integer,
  supersedes     uuid,
  -- Constrained to `request` in the request migration.
  request_id     uuid,
  -- Required on an adjustment by the domain. HR's words.
  reason         text,

  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, person_id) REFERENCES timeoff.member (tenant_id, person_id),
  FOREIGN KEY (tenant_id, leave_type_key) REFERENCES timeoff.leave_type (tenant_id, key),
  FOREIGN KEY (tenant_id, supersedes) REFERENCES timeoff.ledger_entry (tenant_id, id),

  CONSTRAINT ledger_entry_kind_known CHECK (kind IN (
    'grant', 'accrual', 'carry_over', 'expiry', 'booking',
    'taken', 'release', 'borrow', 'adjustment', 'comp_earned'
  )),
  CONSTRAINT ledger_entry_unit_known CHECK (unit IN ('day', 'hour')),
  CONSTRAINT ledger_entry_supersedes_is_not_itself CHECK (supersedes IS NULL OR supersedes <> id)
);

-- One correction per entry. Two writers correcting the same row at once is a
-- race the domain cannot see; correcting a correction names the correction.
CREATE UNIQUE INDEX ledger_entry_one_correction
  ON timeoff.ledger_entry (tenant_id, supersedes)
  WHERE supersedes IS NOT NULL;

-- The fold: one member, one leave type, in effective order.
CREATE INDEX ledger_entry_fold_idx
  ON timeoff.ledger_entry (tenant_id, person_id, leave_type_key, effective_on);

ALTER TABLE timeoff.ledger_entry ENABLE ROW LEVEL SECURITY;
ALTER TABLE timeoff.ledger_entry FORCE  ROW LEVEL SECURITY;
CREATE POLICY ledger_entry_tenant_isolation ON timeoff.ledger_entry
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- ------------------------------------------------------------------ grants --
--
-- The ledger is insert-only for the service, enforced rather than intended:
-- the REVOKE is spelled out so a later broad GRANT or default privilege has
-- to undo it in writing.
GRANT SELECT, INSERT, UPDATE ON timeoff.leave_type     TO svc_timeoff;
GRANT SELECT, INSERT         ON timeoff.policy         TO svc_timeoff;
GRANT SELECT, INSERT, UPDATE ON timeoff.policy_version TO svc_timeoff;
GRANT SELECT, INSERT         ON timeoff.ledger_entry   TO svc_timeoff;
REVOKE UPDATE, DELETE, TRUNCATE ON timeoff.ledger_entry FROM svc_timeoff;
