-- The Performance and Development module's tables (PRD §29, PRF-035).
--
-- Onboarding's shape, taken one step further: the member projection, the audit
-- log and settings have tables of their own, and every aggregate (templates,
-- cycles, reviews, nominations, feedback, notes, goals, learning, automations,
-- calibration sessions, the AI output log, grants) is a row of `record`, with
-- the columns a query filters or constrains on beside its JSON. `key` is unique
-- per kind, which makes creating a review idempotent per (cycle, activity,
-- subject, reviewer) under a race (§8.7); `revision` is what an autosave
-- compares against (§10.2).

-- Who works here, from People's events or the member import.
CREATE TABLE performance.member (
  tenant_id          uuid NOT NULL,
  person_id          uuid NOT NULL,
  account_id         uuid,
  display_name       text NOT NULL,
  work_email         text,
  manager_person_id  uuid,
  status             text NOT NULL DEFAULT 'active',
  title              text,
  org_unit_id        uuid,
  location_id        uuid,
  legal_entity_id    uuid,
  hired_on           date,
  probation_end      date,
  last_event_id      text NOT NULL,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, person_id)
);
CREATE INDEX performance_member_account_idx ON performance.member (tenant_id, account_id);
CREATE INDEX performance_member_manager_idx ON performance.member (tenant_id, manager_person_id);

-- The accounts identity names administrator of `module.performance`.
CREATE TABLE performance.admin (
  tenant_id  uuid NOT NULL,
  account_id uuid NOT NULL,
  PRIMARY KEY (tenant_id, account_id)
);

CREATE TABLE performance.record (
  tenant_id  uuid NOT NULL,
  kind       text NOT NULL CHECK (kind IN ('template', 'cycle', 'review', 'nomination', 'feedback',
    'request', 'note', 'goal', 'item', 'assignment', 'automation', 'calibration', 'ai', 'grant',
    'org_unit', 'chart')),
  id         uuid NOT NULL,
  cycle_id   uuid,
  subject_id uuid,
  owner_id   text,
  state      text,
  key        text,
  revision   integer NOT NULL DEFAULT 0,
  body       jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, kind, id)
);
CREATE UNIQUE INDEX performance_record_key_idx ON performance.record (tenant_id, kind, key) WHERE key IS NOT NULL;
CREATE INDEX performance_record_cycle_idx ON performance.record (tenant_id, kind, cycle_id);
CREATE INDEX performance_record_subject_idx ON performance.record (tenant_id, kind, subject_id);
CREATE INDEX performance_record_owner_idx ON performance.record (tenant_id, kind, owner_id);
CREATE INDEX performance_record_state_idx ON performance.record (tenant_id, kind, state);

-- Every action, refused attempt and sensitive read (§24.1): what was done to
-- what, and the fields by name. Never a value. Append-only.
CREATE TABLE performance.audit (
  tenant_id        uuid NOT NULL,
  id               uuid NOT NULL,
  at               timestamptz NOT NULL,
  actor_person_id  uuid,
  actor_account_id text NOT NULL,
  acting_as        text NOT NULL,
  action           text NOT NULL,
  target           text NOT NULL,
  target_id        text,
  via              text NOT NULL,
  outcome          text NOT NULL CHECK (outcome IN ('done', 'refused')),
  fields           jsonb NOT NULL DEFAULT '[]',
  ai               boolean NOT NULL DEFAULT false,
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX performance_audit_at_idx ON performance.audit (tenant_id, at DESC);

CREATE TABLE performance.settings (
  tenant_id  uuid NOT NULL,
  key        text NOT NULL,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, key)
);

CREATE TABLE performance.idempotency_key (
  tenant_id     uuid        NOT NULL,
  key           text        NOT NULL,
  request_hash  char(64)    NOT NULL,
  status        smallint    NOT NULL,
  answer        jsonb       NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, key),
  CONSTRAINT performance_idempotency_key_length CHECK (length(key) BETWEEN 1 AND 255)
);

-- Every company with Performance, for the sweep.
CREATE TABLE performance.tenant (
  tenant_id     uuid PRIMARY KEY,
  first_seen_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE performance.tenant ENABLE ROW LEVEL SECURITY;
ALTER TABLE performance.tenant FORCE  ROW LEVEL SECURITY;
CREATE POLICY performance_tenant_list ON performance.tenant FOR SELECT USING (true);
CREATE POLICY performance_tenant_register ON performance.tenant FOR INSERT
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT ON performance.tenant TO svc_performance;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['member', 'admin', 'record', 'audit', 'settings', 'idempotency_key']
  LOOP
    EXECUTE format('ALTER TABLE performance.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE performance.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON performance.%I '
      'USING (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid) '
      'WITH CHECK (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid)',
      'performance_' || t || '_tenant_isolation', t);
  END LOOP;
END $$;

-- Append-only: the audit log and idempotency.
GRANT SELECT, INSERT ON performance.audit, performance.idempotency_key TO svc_performance;
GRANT SELECT, INSERT, UPDATE, DELETE ON performance.member, performance.admin, performance.record,
  performance.settings TO svc_performance;
