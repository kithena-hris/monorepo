-- The Recruiting module's own tables (PRD §31.1, REC-040).
--
-- One shape for most aggregates: the columns a query filters, joins or
-- constrains on, and `body` holding the rest of the domain object as JSON.
-- Money is always an integer in minor units (bigint), never a float. The
-- stage history, notes, messages and AI records are append-only. Files' bytes
-- are not here: a file names a key in the recruiting bucket, sealed by the
-- service. Nothing references another module's schema; members are
-- Recruiting's own projection, as Documents' are.

CREATE OR REPLACE FUNCTION recruiting.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- ------------------------------------------------------------- the company --
-- Who works here, from People's events or an import (PRD §5.2).
CREATE TABLE recruiting.member (
  tenant_id           uuid NOT NULL,
  person_id           uuid NOT NULL,
  account_id          uuid,
  display_name        text NOT NULL,
  work_email          text,
  manager_person_id   uuid,
  team_key            text,
  team_name           text,
  location_key        text,
  legal_entity_id     uuid,
  status              text NOT NULL DEFAULT 'active',
  last_event_id       uuid NOT NULL,
  last_effective_from date NOT NULL,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, person_id)
);
CREATE INDEX member_account_idx ON recruiting.member (tenant_id, account_id);
CREATE INDEX member_manager_idx ON recruiting.member (tenant_id, manager_person_id);

-- The accounts identity names administrator of `module.recruiting`.
CREATE TABLE recruiting.admin (
  tenant_id  uuid NOT NULL,
  account_id uuid NOT NULL,
  PRIMARY KEY (tenant_id, account_id)
);

CREATE TABLE recruiting.entity (
  tenant_id                uuid NOT NULL,
  id                       uuid NOT NULL,
  name                     text NOT NULL,
  country                  char(2) NOT NULL CHECK (country IN ('DE', 'ES', 'GB', 'IN', 'US')),
  currency                 char(3) NOT NULL,
  full_time_weekly_minutes integer NOT NULL CHECK (full_time_weekly_minutes BETWEEN 600 AND 3600),
  headcount                integer NOT NULL DEFAULT 0 CHECK (headcount >= 0),
  founded_on               date,
  works_council            boolean NOT NULL DEFAULT false,
  works_council_ids        uuid[] NOT NULL DEFAULT '{}',
  body                     jsonb NOT NULL DEFAULT '{}',
  updated_at               timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE recruiting.org_unit (
  tenant_id  uuid NOT NULL,
  id         uuid NOT NULL,
  name       text NOT NULL,
  parent_id  uuid,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE recruiting.location (
  tenant_id  uuid NOT NULL,
  id         uuid NOT NULL,
  name       text NOT NULL,
  entity_id  uuid,
  country    char(2) NOT NULL,
  region     text,
  city       text,
  time_zone  text NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

-- ------------------------------------------------------------ requisitions --
CREATE TABLE recruiting.requisition (
  tenant_id          uuid NOT NULL,
  id                 uuid NOT NULL,
  state              text NOT NULL CHECK (state IN ('draft', 'pending_approval', 'approved', 'rejected', 'cancelled', 'filled')),
  title              text NOT NULL,
  hiring_manager_id  uuid,
  org_unit_id        uuid,
  legal_entity_id    uuid,
  openings           integer NOT NULL CHECK (openings > 0),
  filled             integer NOT NULL DEFAULT 0 CHECK (filled >= 0),
  budget_to_minor    bigint,
  currency           char(3),
  body               jsonb NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT requisition_filled CHECK (filled <= openings)
);
CREATE INDEX requisition_state_idx ON recruiting.requisition (tenant_id, state);

CREATE TABLE recruiting.approval_chain (
  tenant_id  uuid NOT NULL,
  id         uuid NOT NULL,
  applies_to text NOT NULL CHECK (applies_to IN ('requisition', 'offer')),
  priority   integer NOT NULL,
  body       jsonb NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

-- An approval in flight: the resolved steps and the decisions so far.
CREATE TABLE recruiting.requisition_approval (
  tenant_id      uuid NOT NULL,
  id             uuid NOT NULL,
  requisition_id uuid NOT NULL,
  chain_id       uuid,
  steps          jsonb NOT NULL,
  decisions      jsonb NOT NULL DEFAULT '[]',
  outcome        text NOT NULL DEFAULT 'pending' CHECK (outcome IN ('pending', 'approved', 'rejected', 'superseded')),
  changes        jsonb NOT NULL DEFAULT '[]',
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX requisition_approval_open_idx ON recruiting.requisition_approval (tenant_id, requisition_id) WHERE outcome = 'pending';

-- -------------------------------------------------------------------- jobs --
CREATE TABLE recruiting.job (
  tenant_id     uuid NOT NULL,
  id            uuid NOT NULL,
  state         text NOT NULL CHECK (state IN ('draft', 'open', 'on_hold', 'closed', 'filled')),
  title         text NOT NULL,
  slug          text NOT NULL,
  entity_id     uuid,
  openings      integer NOT NULL CHECK (openings > 0),
  hired         integer NOT NULL DEFAULT 0 CHECK (hired >= 0),
  internal_only boolean NOT NULL DEFAULT false,
  confidential  boolean NOT NULL DEFAULT false,
  body          jsonb NOT NULL,
  opened_at     timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, slug)
);
CREATE INDEX job_state_idx ON recruiting.job (tenant_id, state);

CREATE TABLE recruiting.job_requisition (
  tenant_id      uuid NOT NULL,
  job_id         uuid NOT NULL,
  requisition_id uuid NOT NULL,
  PRIMARY KEY (tenant_id, job_id, requisition_id)
);

-- The hiring team (PRD §25): who holds which role on a job.
CREATE TABLE recruiting.job_team (
  tenant_id uuid NOT NULL,
  job_id    uuid NOT NULL,
  person_id uuid NOT NULL,
  role      text NOT NULL CHECK (role IN ('recruiter', 'hiring_manager', 'interviewer', 'coordinator')),
  PRIMARY KEY (tenant_id, job_id, person_id, role)
);
CREATE INDEX job_team_person_idx ON recruiting.job_team (tenant_id, person_id);

-- The ad, one row per language, each with its own slug (PRD §8.2).
CREATE TABLE recruiting.job_ad (
  tenant_id  uuid NOT NULL,
  job_id     uuid NOT NULL,
  language   text NOT NULL,
  title      text NOT NULL,
  doc        jsonb NOT NULL,
  html       text NOT NULL,
  plain      text NOT NULL,
  checks     jsonb NOT NULL DEFAULT '[]',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, job_id, language)
);

CREATE TABLE recruiting.job_target (
  tenant_id  uuid NOT NULL,
  job_id     uuid NOT NULL,
  target     text NOT NULL,
  state      text NOT NULL CHECK (state IN ('pending', 'live', 'paused', 'expired', 'failed')),
  url        text,
  error      text,
  live_since timestamptz,
  expires_on date,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, job_id, target)
);

CREATE TABLE recruiting.job_criterion (
  tenant_id uuid NOT NULL,
  id        uuid NOT NULL,
  job_id    uuid NOT NULL,
  position  integer NOT NULL,
  text      text NOT NULL,
  must      boolean NOT NULL,
  weight    integer NOT NULL CHECK (weight BETWEEN 1 AND 5),
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE recruiting.pipeline_template (
  tenant_id  uuid NOT NULL,
  id         uuid NOT NULL,
  name       text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  stages     jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);

-- A job's own copy of its pipeline (PRD §12.1): a template change does not touch it.
CREATE TABLE recruiting.stage (
  tenant_id      uuid NOT NULL,
  id             uuid NOT NULL,
  job_id         uuid NOT NULL,
  position       integer NOT NULL,
  name           text NOT NULL,
  candidate_name text,
  category       text NOT NULL CHECK (category IN ('applied', 'screening', 'interview', 'assessment', 'works_council', 'offer', 'hired')),
  automations    jsonb NOT NULL DEFAULT '[]',
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, job_id, position)
);

CREATE TABLE recruiting.form (
  tenant_id  uuid NOT NULL,
  job_id     uuid NOT NULL,
  fields     jsonb NOT NULL,
  questionnaire_id uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, job_id)
);

CREATE TABLE recruiting.questionnaire (
  tenant_id                    uuid NOT NULL,
  id                           uuid NOT NULL,
  version                      integer NOT NULL,
  name                         text NOT NULL,
  works_council_consent_version integer,
  archived                     boolean NOT NULL DEFAULT false,
  updated_at                   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE recruiting.question (
  tenant_id        uuid NOT NULL,
  id               uuid NOT NULL,
  questionnaire_id uuid NOT NULL,
  position         integer NOT NULL,
  body             jsonb NOT NULL,
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX question_questionnaire_idx ON recruiting.question (tenant_id, questionnaire_id, position);

-- -------------------------------------------------------------- candidates --
CREATE TABLE recruiting.candidate (
  tenant_id      uuid NOT NULL,
  id             uuid NOT NULL,
  name           text NOT NULL,
  name_norm      text NOT NULL,
  email          text NOT NULL,
  email_norm     text NOT NULL,
  phone          text,
  phone_tail     text,
  cv_hash        char(64),
  -- An internal applicant: the member they are (PRD §25).
  person_id      uuid,
  body           jsonb NOT NULL DEFAULT '{}',
  merged_into    uuid,
  anonymised_at  timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);
-- One live candidate per email (PRD §11.2): a race between two applications is the constraint's.
CREATE UNIQUE INDEX candidate_email_idx ON recruiting.candidate (tenant_id, email_norm)
  WHERE merged_into IS NULL AND anonymised_at IS NULL;
CREATE INDEX candidate_phone_idx ON recruiting.candidate (tenant_id, phone_tail);
CREATE INDEX candidate_cv_idx ON recruiting.candidate (tenant_id, cv_hash);

CREATE TABLE recruiting.candidate_file (
  tenant_id      uuid NOT NULL,
  id             uuid NOT NULL,
  candidate_id   uuid NOT NULL,
  application_id uuid,
  kind           text NOT NULL CHECK (kind IN ('cv', 'cover_letter', 'portfolio', 'work_sample', 'reference', 'contract', 'other')),
  blob_key       text NOT NULL,
  file_name      text NOT NULL,
  media_type     text NOT NULL,
  size           integer NOT NULL CHECK (size BETWEEN 1 AND 10485760),
  sha256         char(64) NOT NULL,
  uploaded_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX candidate_file_candidate_idx ON recruiting.candidate_file (tenant_id, candidate_id);

-- A file's text, extracted by code (PRD §14.1); searchable without any AI key.
CREATE TABLE recruiting.candidate_text (
  tenant_id uuid NOT NULL,
  file_id   uuid NOT NULL,
  no_text   boolean NOT NULL DEFAULT false,
  text      text NOT NULL DEFAULT '',
  tsv       tsvector GENERATED ALWAYS AS (to_tsvector('simple', text)) STORED,
  PRIMARY KEY (tenant_id, file_id)
);
CREATE INDEX candidate_text_tsv_idx ON recruiting.candidate_text USING gin (tsv);

CREATE TABLE recruiting.application (
  tenant_id      uuid NOT NULL,
  id             uuid NOT NULL,
  candidate_id   uuid NOT NULL,
  job_id         uuid NOT NULL,
  stage_id       uuid NOT NULL,
  category       text NOT NULL,
  outcome        text NOT NULL CHECK (outcome IN ('active', 'hired', 'rejected', 'withdrawn')),
  source         jsonb NOT NULL,
  flagged        boolean NOT NULL DEFAULT false,
  score          integer,
  language       text NOT NULL DEFAULT 'en',
  answers        jsonb NOT NULL DEFAULT '{}',
  adjustments    text,
  rejection      jsonb,
  withdrawn_at   timestamptz,
  decided_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, candidate_id, job_id)
);
CREATE INDEX application_job_idx ON recruiting.application (tenant_id, job_id, outcome);

-- Append-only (PRD §12.2): a correction is a row naming what it supersedes.
CREATE TABLE recruiting.application_stage_event (
  tenant_id      uuid NOT NULL,
  id             uuid NOT NULL,
  application_id uuid NOT NULL,
  from_stage     uuid,
  to_stage       uuid NOT NULL,
  category       text NOT NULL,
  at             timestamptz NOT NULL,
  effective_from date NOT NULL,
  by_person      uuid,
  supersedes     uuid,
  reason         text,
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX stage_event_application_idx ON recruiting.application_stage_event (tenant_id, application_id, at);

-- Answers to a questionnaire sent at a stage (the apply form's are on the application).
CREATE TABLE recruiting.answer (
  tenant_id        uuid NOT NULL,
  application_id   uuid NOT NULL,
  questionnaire_id uuid NOT NULL,
  version          integer NOT NULL,
  answers          jsonb NOT NULL,
  score            integer,
  knocked_out      jsonb NOT NULL DEFAULT '[]',
  answered_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, application_id, questionnaire_id)
);

CREATE TABLE recruiting.consent (
  tenant_id    uuid NOT NULL,
  id           uuid NOT NULL,
  candidate_id uuid NOT NULL,
  purpose      text NOT NULL CHECK (purpose IN ('application', 'talent_pool', 'nyc_aedt_notice')),
  given_at     timestamptz NOT NULL,
  expires_on   date,
  withdrawn_at timestamptz,
  notice       text NOT NULL,
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX consent_candidate_idx ON recruiting.consent (tenant_id, candidate_id, purpose);

CREATE TABLE recruiting.pool (
  tenant_id  uuid NOT NULL,
  id         uuid NOT NULL,
  name       text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE recruiting.pool_member (
  tenant_id    uuid NOT NULL,
  pool_id      uuid NOT NULL,
  candidate_id uuid NOT NULL,
  reason       text NOT NULL,
  added_by     uuid,
  added_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, pool_id, candidate_id)
);

CREATE TABLE recruiting.tag (
  tenant_id uuid NOT NULL,
  id        uuid NOT NULL,
  name      text NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, name)
);

CREATE TABLE recruiting.candidate_tag (
  tenant_id    uuid NOT NULL,
  candidate_id uuid NOT NULL,
  tag_id       uuid NOT NULL,
  PRIMARY KEY (tenant_id, candidate_id, tag_id)
);

CREATE TABLE recruiting.note (
  tenant_id      uuid NOT NULL,
  id             uuid NOT NULL,
  candidate_id   uuid NOT NULL,
  application_id uuid,
  author_id      uuid NOT NULL,
  body           text NOT NULL,
  mentions       uuid[] NOT NULL DEFAULT '{}',
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX note_candidate_idx ON recruiting.note (tenant_id, candidate_id, created_at);

CREATE TABLE recruiting.template (
  tenant_id  uuid NOT NULL,
  id         uuid NOT NULL,
  kind       text NOT NULL CHECK (kind IN ('email', 'offer_letter', 'contract')),
  purpose    text NOT NULL,
  language   text NOT NULL,
  name       text NOT NULL,
  subject    text,
  body       text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);

-- The thread (PRD §12.7): Recruiting keeps it; messaging keeps outcomes only.
CREATE TABLE recruiting.message (
  tenant_id      uuid NOT NULL,
  id             uuid NOT NULL,
  candidate_id   uuid NOT NULL,
  application_id uuid,
  direction      text NOT NULL CHECK (direction IN ('out', 'in')),
  subject        text NOT NULL,
  body           text NOT NULL,
  from_person    uuid,
  template_id    uuid,
  send_at        timestamptz NOT NULL,
  sent_at        timestamptz,
  delivery_id    text,
  read_at        timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX message_candidate_idx ON recruiting.message (tenant_id, candidate_id, created_at);
CREATE INDEX message_due_idx ON recruiting.message (send_at) WHERE sent_at IS NULL AND direction = 'out';

-- ---------------------------------------------------------- interviews --
CREATE TABLE recruiting.interview_plan (
  tenant_id  uuid NOT NULL,
  job_id     uuid NOT NULL,
  body       jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, job_id)
);

CREATE TABLE recruiting.interview (
  tenant_id      uuid NOT NULL,
  id             uuid NOT NULL,
  application_id uuid NOT NULL,
  plan_key       text NOT NULL,
  title          text NOT NULL,
  starts_at      timestamptz NOT NULL,
  minutes        integer NOT NULL CHECK (minutes BETWEEN 5 AND 480),
  state          text NOT NULL CHECK (state IN ('scheduled', 'completed', 'no_show', 'cancelled', 'rescheduled')),
  place          text,
  video_url      text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX interview_application_idx ON recruiting.interview (tenant_id, application_id);
CREATE INDEX interview_starts_idx ON recruiting.interview (tenant_id, starts_at);

CREATE TABLE recruiting.interview_interviewer (
  tenant_id    uuid NOT NULL,
  interview_id uuid NOT NULL,
  person_id    uuid NOT NULL,
  PRIMARY KEY (tenant_id, interview_id, person_id)
);
CREATE INDEX interviewer_person_idx ON recruiting.interview_interviewer (tenant_id, person_id);

-- Self-scheduling links (PRD §16.4): the token's hash only.
CREATE TABLE recruiting.schedule_link (
  tenant_id      uuid NOT NULL,
  token_hash     char(64) NOT NULL,
  application_id uuid NOT NULL,
  body           jsonb NOT NULL,
  expires_at     timestamptz NOT NULL,
  used_at        timestamptz,
  PRIMARY KEY (tenant_id, token_hash)
);

-- Interviewers' working hours, for scheduling without a calendar (PRD §16.4).
CREATE TABLE recruiting.working_hours (
  tenant_id uuid NOT NULL,
  person_id uuid NOT NULL,
  time_zone text NOT NULL,
  week      jsonb NOT NULL,
  PRIMARY KEY (tenant_id, person_id)
);

CREATE TABLE recruiting.scorecard_template (
  tenant_id    uuid NOT NULL,
  id           uuid NOT NULL,
  name         text NOT NULL,
  competencies jsonb NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE recruiting.scorecard (
  tenant_id      uuid NOT NULL,
  interview_id   uuid NOT NULL,
  interviewer_id uuid NOT NULL,
  recommendation text CHECK (recommendation IN ('strong_no', 'no', 'yes', 'strong_yes')),
  notes          text,
  submitted_at   timestamptz,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, interview_id, interviewer_id)
);

-- One rating per competency, an integer on 1–4 (PRD §16.2).
CREATE TABLE recruiting.rating (
  tenant_id      uuid NOT NULL,
  interview_id   uuid NOT NULL,
  interviewer_id uuid NOT NULL,
  competency     text NOT NULL,
  rating         smallint NOT NULL CHECK (rating BETWEEN 1 AND 4),
  PRIMARY KEY (tenant_id, interview_id, interviewer_id, competency)
);

CREATE TABLE recruiting.debrief_decision (
  tenant_id      uuid NOT NULL,
  application_id uuid NOT NULL,
  decision       text NOT NULL CHECK (decision IN ('advance', 'reject', 'offer')),
  reason         text NOT NULL,
  decided_by     uuid NOT NULL,
  decided_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, application_id, decided_at)
);

CREATE TABLE recruiting.reference_request (
  tenant_id      uuid NOT NULL,
  id             uuid NOT NULL,
  application_id uuid NOT NULL,
  referee_name   text NOT NULL,
  referee_email  text NOT NULL,
  relationship   text,
  token_hash     char(64) NOT NULL,
  state          text NOT NULL CHECK (state IN ('named', 'requested', 'completed', 'declined')),
  answers        jsonb,
  requested_at   timestamptz,
  completed_at   timestamptz,
  PRIMARY KEY (tenant_id, id)
);

-- --------------------------------------------------------------- offers --
CREATE TABLE recruiting.offer (
  tenant_id      uuid NOT NULL,
  id             uuid NOT NULL,
  application_id uuid NOT NULL,
  state          text NOT NULL CHECK (state IN ('draft', 'pending_approval', 'approved', 'sent', 'accepted', 'declined', 'expired', 'withdrawn')),
  version        integer NOT NULL,
  base_minor     bigint NOT NULL,
  currency       char(3) NOT NULL,
  acceptance     jsonb,
  body           jsonb NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX offer_application_idx ON recruiting.offer (tenant_id, application_id);

-- Every version ever sent, kept (PRD §18.4).
CREATE TABLE recruiting.offer_version (
  tenant_id     uuid NOT NULL,
  offer_id      uuid NOT NULL,
  version       integer NOT NULL,
  body          jsonb NOT NULL,
  hash          char(64) NOT NULL,
  superseded_at timestamptz,
  PRIMARY KEY (tenant_id, offer_id, version)
);

CREATE TABLE recruiting.offer_approval (
  tenant_id  uuid NOT NULL,
  id         uuid NOT NULL,
  offer_id   uuid NOT NULL,
  version    integer NOT NULL,
  chain_id   uuid,
  steps      jsonb NOT NULL,
  decisions  jsonb NOT NULL DEFAULT '[]',
  outcome    text NOT NULL DEFAULT 'pending' CHECK (outcome IN ('pending', 'approved', 'rejected', 'superseded')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE recruiting.contract (
  tenant_id     uuid NOT NULL,
  id            uuid NOT NULL,
  offer_id      uuid NOT NULL,
  offer_version integer NOT NULL,
  route         text NOT NULL CHECK (route IN ('documents', 'wet_ink', 'upload')),
  state         text NOT NULL CHECK (state IN ('generated', 'out_for_signature', 'signed', 'voided')),
  documents     jsonb NOT NULL,
  pack_version  text NOT NULL,
  subject_ref   text NOT NULL,
  file_id       uuid,
  signed_on     date,
  signed_by     text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, subject_ref)
);

CREATE TABLE recruiting.prehire (
  tenant_id      uuid NOT NULL,
  application_id uuid NOT NULL,
  candidate_id   uuid NOT NULL,
  start_date     date NOT NULL,
  state          text NOT NULL CHECK (state IN ('conditions_open', 'conditions_met', 'started', 'cancelled')),
  cancel_reason  text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, application_id)
);

CREATE TABLE recruiting.condition (
  tenant_id      uuid NOT NULL,
  application_id uuid NOT NULL,
  kind           text NOT NULL,
  state          text NOT NULL CHECK (state IN ('open', 'met', 'waived', 'failed')),
  decided_by     uuid,
  decided_at     timestamptz,
  note           text,
  PRIMARY KEY (tenant_id, application_id, kind)
);

CREATE TABLE recruiting.benefit (
  tenant_id  uuid NOT NULL,
  id         uuid NOT NULL,
  entity_id  uuid NOT NULL,
  key        text NOT NULL,
  category   text NOT NULL,
  statutory  boolean NOT NULL DEFAULT false,
  body       jsonb NOT NULL,
  archived   boolean NOT NULL DEFAULT false,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, entity_id, key)
);

CREATE TABLE recruiting.pay_band (
  tenant_id  uuid NOT NULL,
  id         uuid NOT NULL,
  entity_id  uuid,
  grade      text NOT NULL,
  min_minor  bigint NOT NULL,
  max_minor  bigint NOT NULL,
  currency   char(3) NOT NULL,
  -- `recruiting` for the module's own; `people` for the projection of `people.pay_band.set`.
  source     text NOT NULL CHECK (source IN ('recruiting', 'people')),
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT pay_band_order CHECK (min_minor <= max_minor)
);

-- A tenant's stricter defaults and its collective agreement's values (PRD §19.1).
CREATE TABLE recruiting.terms_tenant_value (
  tenant_id uuid NOT NULL,
  entity_id uuid NOT NULL,
  key       text NOT NULL,
  value     jsonb NOT NULL,
  PRIMARY KEY (tenant_id, entity_id, key)
);

-- ----------------------------------------------- sources and partners --
CREATE TABLE recruiting.source (
  tenant_id uuid NOT NULL,
  key       text NOT NULL,
  name      text NOT NULL,
  PRIMARY KEY (tenant_id, key)
);

CREATE TABLE recruiting.source_cost (
  tenant_id    uuid NOT NULL,
  id           uuid NOT NULL,
  source_key   text NOT NULL,
  month        date NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
  currency     char(3) NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE recruiting.referral (
  tenant_id       uuid NOT NULL,
  id              uuid NOT NULL,
  job_id          uuid NOT NULL,
  referrer_id     uuid NOT NULL,
  candidate_name  text NOT NULL,
  candidate_email text NOT NULL,
  note            text,
  application_id  uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE recruiting.agency (
  tenant_id        uuid NOT NULL,
  id               uuid NOT NULL,
  name             text NOT NULL,
  contact_email    text NOT NULL,
  fee              jsonb NOT NULL,
  guarantee_days   integer NOT NULL DEFAULT 90,
  ownership_months integer NOT NULL DEFAULT 6,
  active           boolean NOT NULL DEFAULT true,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE recruiting.agency_job (
  tenant_id uuid NOT NULL,
  agency_id uuid NOT NULL,
  job_id    uuid NOT NULL,
  PRIMARY KEY (tenant_id, agency_id, job_id)
);

CREATE TABLE recruiting.agency_submission (
  tenant_id      uuid NOT NULL,
  id             uuid NOT NULL,
  agency_id      uuid NOT NULL,
  job_id         uuid NOT NULL,
  email_norm     text NOT NULL,
  application_id uuid,
  submitted_on   date NOT NULL,
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX agency_submission_email_idx ON recruiting.agency_submission (tenant_id, email_norm);

-- ------------------------------------------------------------------- AI --
-- Phase 2 (PRD §22.2): every assessment logged with what the model read.
CREATE TABLE recruiting.ai_assessment (
  tenant_id      uuid NOT NULL,
  id             uuid NOT NULL,
  application_id uuid NOT NULL,
  feature        text NOT NULL,
  model          text NOT NULL,
  prompt_version text NOT NULL,
  input_hash     char(64) NOT NULL,
  masked_input   text NOT NULL,
  output         jsonb NOT NULL,
  score_bp       integer,
  band           text,
  requested_by   uuid NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE recruiting.ai_verdict (
  tenant_id     uuid NOT NULL,
  assessment_id uuid NOT NULL,
  criterion_id  uuid NOT NULL,
  verdict       text NOT NULL CHECK (verdict IN ('met', 'partly_met', 'not_met', 'not_evidenced')),
  passages      jsonb NOT NULL,
  -- A person's agreement (PRD §14.4): null until they say.
  agreed        boolean,
  agreed_by     uuid,
  PRIMARY KEY (tenant_id, assessment_id, criterion_id)
);

CREATE TABLE recruiting.chart_plan (
  tenant_id  uuid NOT NULL,
  id         uuid NOT NULL,
  question   text,
  plan       jsonb NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE recruiting.saved_view (
  tenant_id  uuid NOT NULL,
  id         uuid NOT NULL,
  owner_id   uuid NOT NULL,
  dashboard  text NOT NULL,
  name       text NOT NULL,
  query      text NOT NULL,
  schedule   text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);

-- Voluntary self-ID (PRD §24.4): sealed, a separate grant, aggregates only.
CREATE TABLE recruiting.self_id (
  tenant_id      uuid NOT NULL,
  application_id uuid NOT NULL,
  sealed         bytea NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, application_id)
);

CREATE TABLE recruiting.calendar_link (
  tenant_id  uuid NOT NULL,
  person_id  uuid NOT NULL,
  provider   text NOT NULL CHECK (provider IN ('google', 'microsoft')),
  sealed     bytea NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, person_id, provider)
);

-- ------------------------------------------------------- public access --
-- Six-digit codes confirming an applicant's email (PRD §10.4): hashes only.
CREATE TABLE recruiting.email_code (
  tenant_id   uuid NOT NULL,
  email_norm  text NOT NULL,
  job_id      uuid NOT NULL,
  code_hash   char(64) NOT NULL,
  attempts    smallint NOT NULL DEFAULT 0,
  expires_at  timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, email_norm, job_id)
);

-- The candidate page's magic links (PRD §10.5): hashes only.
CREATE TABLE recruiting.portal_token (
  tenant_id    uuid NOT NULL,
  token_hash   char(64) NOT NULL,
  candidate_id uuid NOT NULL,
  expires_at   timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, token_hash)
);

-- --------------------------------------------------------------- plumbing --
CREATE TABLE recruiting.settings (
  tenant_id  uuid NOT NULL,
  key        text NOT NULL,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, key)
);

CREATE TABLE recruiting.legal_hold (
  tenant_id    uuid NOT NULL,
  candidate_id uuid NOT NULL,
  reason       text NOT NULL,
  placed_by    uuid NOT NULL,
  placed_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, candidate_id)
);

CREATE TABLE recruiting.rights_request (
  tenant_id    uuid NOT NULL,
  id           uuid NOT NULL,
  candidate_id uuid NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('access', 'correction', 'deletion', 'objection', 'human_review')),
  received_at  timestamptz NOT NULL DEFAULT now(),
  answered_at  timestamptz,
  answered_by  uuid,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE recruiting.idempotency_key (
  tenant_id     uuid        NOT NULL,
  key           text        NOT NULL,
  request_hash  char(64)    NOT NULL,
  status        smallint    NOT NULL,
  answer        jsonb       NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, key),
  CONSTRAINT idempotency_key_length CHECK (length(key) BETWEEN 1 AND 255)
);

-- Every tenant with Recruiting, for the sweeps: Documents' `documents.tenant`.
CREATE TABLE recruiting.tenant (
  tenant_id     uuid PRIMARY KEY,
  slug          text UNIQUE,
  first_seen_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE recruiting.tenant ENABLE ROW LEVEL SECURITY;
ALTER TABLE recruiting.tenant FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_list ON recruiting.tenant FOR SELECT USING (true);
CREATE POLICY tenant_register ON recruiting.tenant FOR INSERT
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY tenant_update ON recruiting.tenant FOR UPDATE
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE ON recruiting.tenant TO svc_recruiting;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['entity', 'requisition', 'job', 'job_ad', 'job_target', 'pipeline_template',
    'form', 'questionnaire', 'candidate', 'application', 'template', 'interview', 'interview_plan',
    'scorecard', 'scorecard_template', 'offer', 'prehire', 'member', 'settings']
  LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON recruiting.%I FOR EACH ROW EXECUTE FUNCTION recruiting.touch_updated_at()', t || '_touch', t);
  END LOOP;
END $$;

-- Every table: the tenant policy, as the bootstrap sets out.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['member', 'admin', 'entity', 'org_unit', 'location', 'requisition',
    'approval_chain', 'requisition_approval', 'job', 'job_requisition', 'job_team', 'job_ad',
    'job_target', 'job_criterion', 'pipeline_template', 'stage', 'form', 'questionnaire', 'question',
    'candidate', 'candidate_file', 'candidate_text', 'application', 'application_stage_event',
    'answer', 'consent', 'pool', 'pool_member', 'tag', 'candidate_tag', 'note', 'template', 'message',
    'interview_plan', 'interview', 'interview_interviewer', 'schedule_link', 'working_hours',
    'scorecard_template', 'scorecard', 'rating', 'debrief_decision', 'reference_request', 'offer',
    'offer_version', 'offer_approval', 'contract', 'prehire', 'condition', 'benefit', 'pay_band',
    'terms_tenant_value', 'source', 'source_cost', 'referral', 'agency', 'agency_job',
    'agency_submission', 'ai_assessment', 'ai_verdict', 'chart_plan', 'saved_view', 'self_id',
    'calendar_link', 'email_code', 'portal_token', 'settings', 'legal_hold', 'rights_request',
    'idempotency_key']
  LOOP
    EXECUTE format('ALTER TABLE recruiting.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE recruiting.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON recruiting.%I '
      'USING (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid) '
      'WITH CHECK (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid)',
      t || '_tenant_isolation', t);
  END LOOP;
END $$;

-- Append-only: the stage history, notes, AI records, idempotency.
GRANT SELECT, INSERT ON recruiting.application_stage_event, recruiting.note, recruiting.ai_assessment,
  recruiting.chart_plan, recruiting.idempotency_key, recruiting.offer_version, recruiting.debrief_decision
  TO svc_recruiting;
GRANT UPDATE (superseded_at) ON recruiting.offer_version TO svc_recruiting;
-- Everything else is read and written by the service; deletes are retention's
-- anonymisation, a projection rewritten, or a link removed.
GRANT SELECT, INSERT, UPDATE, DELETE ON recruiting.member, recruiting.admin, recruiting.entity,
  recruiting.org_unit, recruiting.location, recruiting.requisition, recruiting.approval_chain,
  recruiting.requisition_approval, recruiting.job, recruiting.job_requisition, recruiting.job_team,
  recruiting.job_ad, recruiting.job_target, recruiting.job_criterion, recruiting.pipeline_template,
  recruiting.stage, recruiting.form, recruiting.questionnaire, recruiting.question,
  recruiting.candidate, recruiting.candidate_file, recruiting.candidate_text, recruiting.application,
  recruiting.answer, recruiting.consent, recruiting.pool, recruiting.pool_member, recruiting.tag,
  recruiting.candidate_tag, recruiting.template, recruiting.message, recruiting.interview_plan,
  recruiting.interview, recruiting.interview_interviewer, recruiting.schedule_link,
  recruiting.working_hours, recruiting.scorecard_template, recruiting.scorecard, recruiting.rating,
  recruiting.reference_request, recruiting.offer, recruiting.offer_approval, recruiting.contract,
  recruiting.prehire, recruiting.condition, recruiting.benefit, recruiting.pay_band,
  recruiting.terms_tenant_value, recruiting.source, recruiting.source_cost, recruiting.referral,
  recruiting.agency, recruiting.agency_job, recruiting.agency_submission, recruiting.ai_verdict,
  recruiting.saved_view, recruiting.self_id, recruiting.calendar_link, recruiting.email_code,
  recruiting.portal_token, recruiting.settings, recruiting.legal_hold, recruiting.rights_request
  TO svc_recruiting;

-- ------------------------------------------------- the public projection --
-- What Kithena Jobs reads across companies (PRD §31.2). No tenant policy, on
-- purpose; every column is a public field of `PublicListing`/`PublicJob`.
CREATE TABLE recruiting_public.company (
  tenant_id   uuid PRIMARY KEY,
  slug        text NOT NULL UNIQUE,
  name        text NOT NULL,
  theme_id    text NOT NULL,
  logo_url    text,
  about       text,
  searchable  boolean NOT NULL DEFAULT false,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE recruiting_public.listing (
  job_id           uuid NOT NULL,
  language         text NOT NULL,
  tenant_id        uuid NOT NULL,
  company_slug     text NOT NULL,
  slug             text NOT NULL,
  title            text NOT NULL,
  country          char(2)[] NOT NULL,
  work_mode        text NOT NULL,
  contract_type    text NOT NULL,
  hours            text NOT NULL,
  department       text,
  seniority        text,
  salary_min_minor bigint,
  salary_max_minor bigint,
  currency         char(3),
  salary_period    text,
  posted_at        timestamptz NOT NULL,
  valid_through    date,
  searchable       boolean NOT NULL,
  closed           boolean NOT NULL DEFAULT false,
  page             jsonb NOT NULL,
  tsv              tsvector NOT NULL,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (job_id, language),
  UNIQUE (company_slug, slug)
);
CREATE INDEX listing_tsv_idx ON recruiting_public.listing USING gin (tsv);
CREATE INDEX listing_search_idx ON recruiting_public.listing (searchable, closed, posted_at DESC);
CREATE INDEX listing_country_idx ON recruiting_public.listing USING gin (country);
CREATE INDEX listing_company_idx ON recruiting_public.listing (company_slug, closed);

GRANT SELECT, INSERT, UPDATE, DELETE ON recruiting_public.company, recruiting_public.listing TO svc_recruiting;
GRANT SELECT ON recruiting_public.company, recruiting_public.listing TO svc_jobs_reader;
