-- The Onboarding module's tables (Recruiting PRD §O11, ONB-006).
--
-- Recruiting's shape: the columns a query filters or constrains on, `body`
-- holding the rest of the aggregate as JSON. A plan's tasks are rows of their
-- own so the board and the Inbox can ask "what is late, and whose" in SQL.

-- Who works here, from People's events or an import.
CREATE TABLE onboarding.member (
  tenant_id           uuid NOT NULL,
  person_id           uuid NOT NULL,
  account_id          uuid,
  display_name        text NOT NULL,
  work_email          text,
  manager_person_id   uuid,
  status              text NOT NULL DEFAULT 'active',
  last_event_id       uuid NOT NULL,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, person_id)
);
CREATE INDEX onboarding_member_account_idx ON onboarding.member (tenant_id, account_id);

-- The accounts identity names administrator of `module.onboarding`.
CREATE TABLE onboarding.admin (
  tenant_id  uuid NOT NULL,
  account_id uuid NOT NULL,
  PRIMARY KEY (tenant_id, account_id)
);

-- A hire, from whichever system it came; one per source id.
CREATE TABLE onboarding.hire (
  tenant_id   uuid NOT NULL,
  id          uuid NOT NULL,
  source      text NOT NULL CHECK (source IN ('recruiting', 'people', 'webhook')),
  external_id text NOT NULL,
  person_id   uuid,
  body        jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, source, external_id)
);
CREATE INDEX onboarding_hire_person_idx ON onboarding.hire (tenant_id, person_id);

CREATE TABLE onboarding.template (
  tenant_id uuid NOT NULL,
  id        uuid NOT NULL,
  name      text NOT NULL,
  active    boolean NOT NULL DEFAULT true,
  body      jsonb NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE onboarding.plan (
  tenant_id     uuid NOT NULL,
  id            uuid NOT NULL,
  hire_id       uuid NOT NULL,
  state         text NOT NULL CHECK (state IN ('scheduled', 'in_progress', 'completed', 'cancelled')),
  start_date    date NOT NULL,
  probation_end date,
  manager_id    uuid,
  buddy_id      uuid,
  person_id     uuid,
  -- The welcome page's token, kept only as its hash.
  welcome_hash  char(64),
  body          jsonb NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, hire_id),
  FOREIGN KEY (tenant_id, hire_id) REFERENCES onboarding.hire (tenant_id, id)
);
CREATE INDEX onboarding_plan_state_idx ON onboarding.plan (tenant_id, state, start_date);
CREATE UNIQUE INDEX onboarding_plan_welcome_idx ON onboarding.plan (welcome_hash) WHERE welcome_hash IS NOT NULL;

CREATE TABLE onboarding.task (
  tenant_id        uuid NOT NULL,
  id               uuid NOT NULL,
  plan_id          uuid NOT NULL,
  key              text NOT NULL,
  owner_role       text NOT NULL,
  owner_person_id  uuid,
  due_on           date NOT NULL,
  state            text NOT NULL CHECK (state IN ('open', 'done')),
  body             jsonb NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, plan_id, key),
  FOREIGN KEY (tenant_id, plan_id) REFERENCES onboarding.plan (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX onboarding_task_owner_idx ON onboarding.task (tenant_id, owner_role, state, due_on);

-- A day-30, -60 or -90 conversation's notes, by the new hire or the manager.
CREATE TABLE onboarding.check_in (
  tenant_id  uuid NOT NULL,
  id         uuid NOT NULL,
  plan_id    uuid NOT NULL,
  day        smallint NOT NULL CHECK (day IN (30, 60, 90)),
  by_person  uuid NOT NULL,
  body       jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, plan_id, day, by_person),
  FOREIGN KEY (tenant_id, plan_id) REFERENCES onboarding.plan (tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE onboarding.probation_review (
  tenant_id     uuid NOT NULL,
  plan_id       uuid NOT NULL,
  outcome       text NOT NULL CHECK (outcome IN ('passed', 'extended', 'failed')),
  probation_end date,
  decided_by    uuid NOT NULL,
  decided_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, plan_id, decided_at),
  FOREIGN KEY (tenant_id, plan_id) REFERENCES onboarding.plan (tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE onboarding.settings (
  tenant_id  uuid NOT NULL,
  key        text NOT NULL,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, key)
);

CREATE TABLE onboarding.idempotency_key (
  tenant_id     uuid        NOT NULL,
  key           text        NOT NULL,
  request_hash  char(64)    NOT NULL,
  status        smallint    NOT NULL,
  answer        jsonb       NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, key),
  CONSTRAINT onboarding_idempotency_key_length CHECK (length(key) BETWEEN 1 AND 255)
);

-- Every tenant with Onboarding, for the daily sweep, and the slug its welcome
-- page is reached under.
CREATE TABLE onboarding.tenant (
  tenant_id     uuid PRIMARY KEY,
  slug          text UNIQUE,
  first_seen_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE onboarding.tenant ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding.tenant FORCE  ROW LEVEL SECURITY;
CREATE POLICY onboarding_tenant_list ON onboarding.tenant FOR SELECT USING (true);
CREATE POLICY onboarding_tenant_register ON onboarding.tenant FOR INSERT
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY onboarding_tenant_update ON onboarding.tenant FOR UPDATE
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE ON onboarding.tenant TO svc_onboarding;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['member', 'admin', 'hire', 'template', 'plan', 'task', 'check_in',
    'probation_review', 'settings', 'idempotency_key']
  LOOP
    EXECUTE format('ALTER TABLE onboarding.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE onboarding.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON onboarding.%I '
      'USING (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid) '
      'WITH CHECK (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid)',
      'onboarding_' || t || '_tenant_isolation', t);
  END LOOP;
END $$;

-- Append-only: reviews, check-ins, idempotency.
GRANT SELECT, INSERT ON onboarding.probation_review, onboarding.check_in, onboarding.idempotency_key
  TO svc_onboarding;
GRANT SELECT, INSERT, UPDATE, DELETE ON onboarding.member, onboarding.admin, onboarding.hire,
  onboarding.template, onboarding.plan, onboarding.task, onboarding.settings
  TO svc_onboarding;
