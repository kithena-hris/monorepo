-- Parental leave plans and their blocks (PRD §12, §17, TOF-102).
--
-- A plan is the parent's four answers, what teammates see, the handover and
-- where it is in draft → submitted → approved; its blocks are the weeks laid
-- out around the law's fixed and flexible parts. The rules (whole weeks,
-- deadlines, totals) are the domain's, checked on every read and enforced on
-- sending and approving: a block that breaks one is kept while the plan is a
-- draft, because the parent is still dragging it.
--
-- `due_date` says a pregnancy exists: special-category health data, as the
-- `plan_submitted` event classifies it. `birth_date` is a minor's date of
-- birth. Neither leaves this schema except in those classified events.

-- ----------------------------------------------------------- parental_plan --
CREATE TABLE timeoff.parental_plan (
  tenant_id      uuid NOT NULL,
  id             uuid NOT NULL,
  person_id      uuid NOT NULL,
  status         text NOT NULL DEFAULT 'draft',
  -- The country whose pack decided the law when the plan was answered.
  country        char(2) NOT NULL,
  role           text NOT NULL,
  -- The due date or the adoption decision, then the birth once recorded.
  child_date     date NOT NULL,
  due_date       date,
  birth_date     date,
  single_parent  boolean NOT NULL DEFAULT false,
  children       smallint NOT NULL DEFAULT 1,
  -- The company's own weeks as they were when the plan was answered.
  company        jsonb,
  team_sees      text NOT NULL DEFAULT 'type',
  -- Who covers what, typed by the parent (manual until Projects exists).
  handover       jsonb NOT NULL DEFAULT '[]'::jsonb,
  version        integer NOT NULL DEFAULT 0,
  sent_at        timestamptz,
  approved_at    timestamptz,
  approved_by    uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, person_id) REFERENCES timeoff.member (tenant_id, person_id),

  CONSTRAINT parental_plan_status_known CHECK (status IN ('draft', 'submitted', 'approved')),
  CONSTRAINT parental_plan_role_known CHECK (role IN ('birth_parent', 'other_parent', 'adopting')),
  CONSTRAINT parental_plan_team_sees_known CHECK (team_sees IN ('type', 'away')),
  CONSTRAINT parental_plan_children_positive CHECK (children BETWEEN 1 AND 9),
  CONSTRAINT parental_plan_sent_when_sent CHECK ((status = 'draft') = (sent_at IS NULL)),
  CONSTRAINT parental_plan_handover_is_a_list CHECK (jsonb_typeof(handover) = 'array')
);

-- One plan in flight per member: a second draft, or a draft beside one with
-- HR, is two parents' worth of the same leave.
CREATE UNIQUE INDEX parental_plan_one_open
  ON timeoff.parental_plan (tenant_id, person_id)
  WHERE status IN ('draft', 'submitted');

CREATE INDEX parental_plan_by_status ON timeoff.parental_plan (tenant_id, status);

ALTER TABLE timeoff.parental_plan ENABLE ROW LEVEL SECURITY;
ALTER TABLE timeoff.parental_plan FORCE  ROW LEVEL SECURITY;
CREATE POLICY parental_plan_tenant_isolation ON timeoff.parental_plan
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE TRIGGER parental_plan_touch_updated_at
  BEFORE UPDATE ON timeoff.parental_plan
  FOR EACH ROW EXECUTE FUNCTION timeoff.touch_updated_at();

-- ---------------------------------------------------------- parental_block --
--
-- No foreign key to `leave_type`: a block is a plan, not a booking, and the
-- company's weeks name whatever type the tenant books them as.
CREATE TABLE timeoff.parental_block (
  tenant_id       uuid NOT NULL,
  plan_id         uuid NOT NULL,
  position        smallint NOT NULL,
  kind            text NOT NULL,
  leave_type_key  text NOT NULL,
  from_on         date NOT NULL,
  to_on           date NOT NULL,

  PRIMARY KEY (tenant_id, plan_id, position),
  FOREIGN KEY (tenant_id, plan_id) REFERENCES timeoff.parental_plan (tenant_id, id) ON DELETE CASCADE,

  CONSTRAINT parental_block_kind_known
    CHECK (kind IN ('mandatory', 'flexible', 'vacation', 'company', 'later')),
  CONSTRAINT parental_block_in_order CHECK (from_on <= to_on)
);

ALTER TABLE timeoff.parental_block ENABLE ROW LEVEL SECURITY;
ALTER TABLE timeoff.parental_block FORCE  ROW LEVEL SECURITY;
CREATE POLICY parental_block_tenant_isolation ON timeoff.parental_block
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- ----------------------------------------------------------------- setting --
--
-- The company's own parental weeks (T8: "Acme adds 2 paid weeks after a
-- year"), one document like the other settings. Widening the list of keys is
-- an expand: every row already there still passes.
ALTER TABLE timeoff.setting DROP CONSTRAINT setting_key_known;
ALTER TABLE timeoff.setting ADD CONSTRAINT setting_key_known
  CHECK (key IN ('auto_approval', 'attendance_rules', 'parental_company'));

-- A plan is answered, edited and sent, never deleted; its blocks are
-- replaced whole while it is a draft.
GRANT SELECT, INSERT, UPDATE         ON timeoff.parental_plan  TO svc_timeoff;
GRANT SELECT, INSERT, UPDATE, DELETE ON timeoff.parental_block TO svc_timeoff;
