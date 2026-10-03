-- Attendance: kiosks, punches, schedules and pay periods (PRD §11, TOF-033).
--
-- **No coordinate column anywhere.** Location is checked at the moment of
-- punching to suggest "Office" and is never stored (§11.2, MT3). The punch
-- keeps the derived work model and, under a geofence policy, a boolean. The
-- integration test asserts `punch`'s column list rather than trusting this.

-- ------------------------------------------------------------ kiosk_device --
--
-- A wall tablet at a location (§11.9). It authenticates with a revocable
-- token scoped to punching there; only the token's SHA-256 is kept, so a
-- backup or a support query yields nothing a kiosk could be impersonated with.
CREATE TABLE timeoff.kiosk_device (
  tenant_id    uuid NOT NULL,
  id           uuid NOT NULL,
  location_key text NOT NULL,
  name         text NOT NULL,
  token_hash   bytea NOT NULL,
  last_seen_at timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (tenant_id, id),
  CONSTRAINT kiosk_device_token_hash_key UNIQUE (token_hash),
  CONSTRAINT kiosk_device_token_hash_is_sha256 CHECK (octet_length(token_hash) = 32)
);

ALTER TABLE timeoff.kiosk_device ENABLE ROW LEVEL SECURITY;
ALTER TABLE timeoff.kiosk_device FORCE  ROW LEVEL SECURITY;
CREATE POLICY kiosk_device_tenant_isolation ON timeoff.kiosk_device
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE TRIGGER kiosk_device_touch_updated_at
  BEFORE UPDATE ON timeoff.kiosk_device
  FOR EACH ROW EXECUTE FUNCTION timeoff.touch_updated_at();

-- ------------------------------------------------------------------- punch --
--
-- Append-only. A correction is a new punch carrying `supersedes`; the
-- original stays, because the Spanish record shows what was punched as well
-- as what was agreed afterwards (§11.4). The clock is read from these rows.
CREATE TABLE timeoff.punch (
  tenant_id          uuid NOT NULL,
  -- UUIDv7, and also the id of the event the punch raised.
  id                 uuid NOT NULL,
  person_id          uuid NOT NULL,
  -- When it happened. A kiosk replaying offline punches sets it itself.
  at                 timestamptz NOT NULL,
  -- When we were told.
  recorded_at        timestamptz NOT NULL,
  kind               text NOT NULL,
  source             text NOT NULL,
  work_model         text NOT NULL,
  device_id          uuid,
  -- Null unless a geofence policy is on. A boolean, never a place.
  inside_office_area boolean,
  supersedes         uuid,
  reason             text,

  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, person_id) REFERENCES timeoff.member (tenant_id, person_id),
  FOREIGN KEY (tenant_id, device_id) REFERENCES timeoff.kiosk_device (tenant_id, id),
  FOREIGN KEY (tenant_id, supersedes) REFERENCES timeoff.punch (tenant_id, id),

  CONSTRAINT punch_kind_known CHECK (kind IN ('in', 'out', 'break_start', 'break_end')),
  CONSTRAINT punch_source_known CHECK (source IN ('badge', 'kiosk', 'web', 'mobile')),
  CONSTRAINT punch_work_model_known CHECK (work_model IN ('office', 'remote', 'client')),
  CONSTRAINT punch_supersedes_is_not_itself CHECK (supersedes IS NULL OR supersedes <> id)
);

-- One correction per punch; correcting a correction names the correction.
CREATE UNIQUE INDEX punch_one_correction
  ON timeoff.punch (tenant_id, supersedes)
  WHERE supersedes IS NOT NULL;

-- The clock and the timesheet: one member's punches in time order.
CREATE INDEX punch_timeline_idx ON timeoff.punch (tenant_id, person_id, at);

ALTER TABLE timeoff.punch ENABLE ROW LEVEL SECURITY;
ALTER TABLE timeoff.punch FORCE  ROW LEVEL SECURITY;
CREATE POLICY punch_tenant_isolation ON timeoff.punch
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- ---------------------------------------------------------------- schedule --
--
-- Fixed, flexible with core hours, seasonal, rotating (§11.5). The domain's
-- `Schedule` is recursive — a season holds a schedule — so it is one
-- document, read and written whole.
CREATE TABLE timeoff.schedule (
  tenant_id  uuid NOT NULL,
  key        text NOT NULL,
  name       text NOT NULL,
  kind       text NOT NULL,
  definition jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (tenant_id, key),

  CONSTRAINT schedule_key_shape CHECK (key ~ '^[a-z][a-z0-9_]*$' AND length(key) <= 64),
  CONSTRAINT schedule_kind_known CHECK (kind IN ('fixed', 'flexible', 'seasonal', 'rotating')),
  CONSTRAINT schedule_definition_is_an_object CHECK (jsonb_typeof(definition) = 'object')
);

ALTER TABLE timeoff.schedule ENABLE ROW LEVEL SECURITY;
ALTER TABLE timeoff.schedule FORCE  ROW LEVEL SECURITY;
CREATE POLICY schedule_tenant_isolation ON timeoff.schedule
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE TRIGGER schedule_touch_updated_at
  BEFORE UPDATE ON timeoff.schedule
  FOR EACH ROW EXECUTE FUNCTION timeoff.touch_updated_at();

-- --------------------------------------------------------- member_schedule --
--
-- Which schedule a member works, effective dated: a move to summer hours or
-- a new shift pattern is a new row from its date, and last month's timesheet
-- still reads last month's schedule.
CREATE TABLE timeoff.member_schedule (
  tenant_id      uuid NOT NULL,
  person_id      uuid NOT NULL,
  effective_from date NOT NULL,
  schedule_key   text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (tenant_id, person_id, effective_from),
  FOREIGN KEY (tenant_id, person_id) REFERENCES timeoff.member (tenant_id, person_id),
  FOREIGN KEY (tenant_id, schedule_key) REFERENCES timeoff.schedule (tenant_id, key)
);

ALTER TABLE timeoff.member_schedule ENABLE ROW LEVEL SECURITY;
ALTER TABLE timeoff.member_schedule FORCE  ROW LEVEL SECURITY;
CREATE POLICY member_schedule_tenant_isolation ON timeoff.member_schedule
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- -------------------------------------------------------------- pay_period --
--
-- A month of attendance, closed and sent to Payroll (§11.8). Locked when
-- closed: a later correction dated inside it posts to the next open period
-- with `supersedes`, so what Payroll was sent stays what it was sent.
CREATE TABLE timeoff.pay_period (
  tenant_id  uuid NOT NULL,
  id         uuid NOT NULL,
  starts_on  date NOT NULL,
  ends_on    date NOT NULL,
  closed_at  timestamptz,
  -- The account that closed it.
  closed_by  uuid,
  created_at timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (tenant_id, id),

  CONSTRAINT pay_period_ends_after_start CHECK (ends_on >= starts_on),
  CONSTRAINT pay_period_closed_by_somebody CHECK ((closed_at IS NULL) = (closed_by IS NULL)),
  -- One period per day per tenant, or a line could belong to two.
  CONSTRAINT pay_period_no_overlap EXCLUDE USING gist (
    tenant_id WITH =,
    daterange(starts_on, ends_on, '[]') WITH &&
  )
);

ALTER TABLE timeoff.pay_period ENABLE ROW LEVEL SECURITY;
ALTER TABLE timeoff.pay_period FORCE  ROW LEVEL SECURITY;
CREATE POLICY pay_period_tenant_isolation ON timeoff.pay_period
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE OR REPLACE FUNCTION timeoff.refuse_closed_period_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.closed_at IS NOT NULL THEN
    RAISE EXCEPTION 'pay period % is closed; post the correction to the next open one', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;

CREATE TRIGGER pay_period_closed_is_locked
  BEFORE UPDATE OR DELETE ON timeoff.pay_period
  FOR EACH ROW EXECUTE FUNCTION timeoff.refuse_closed_period_change();

-- --------------------------------------------------------- pay_period_line --
--
-- A member's day as Payroll counts it, posted to a period. Minutes as
-- integers: exact, and what the domain counts in. Append-only; a correction
-- is a new line naming the one it replaces.
CREATE TABLE timeoff.pay_period_line (
  tenant_id      uuid NOT NULL,
  id             uuid NOT NULL,
  period_id      uuid NOT NULL,
  person_id      uuid NOT NULL,
  team_key       text NOT NULL,
  -- The day it is about, which may sit in an earlier, closed period.
  day            date NOT NULL,
  worked_minutes integer NOT NULL,
  -- Overtime banked as comp time, and overtime paid.
  comp_minutes   integer NOT NULL DEFAULT 0,
  paid_minutes   integer NOT NULL DEFAULT 0,
  supersedes     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, period_id) REFERENCES timeoff.pay_period (tenant_id, id),
  FOREIGN KEY (tenant_id, person_id) REFERENCES timeoff.member (tenant_id, person_id),
  FOREIGN KEY (tenant_id, supersedes) REFERENCES timeoff.pay_period_line (tenant_id, id),

  CONSTRAINT pay_period_line_minutes_not_negative CHECK (
    worked_minutes >= 0 AND comp_minutes >= 0 AND paid_minutes >= 0
  ),
  CONSTRAINT pay_period_line_supersedes_is_not_itself CHECK (supersedes IS NULL OR supersedes <> id)
);

CREATE INDEX pay_period_line_period_idx ON timeoff.pay_period_line (tenant_id, period_id);

ALTER TABLE timeoff.pay_period_line ENABLE ROW LEVEL SECURITY;
ALTER TABLE timeoff.pay_period_line FORCE  ROW LEVEL SECURITY;
CREATE POLICY pay_period_line_tenant_isolation ON timeoff.pay_period_line
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- Nothing posts into a closed period. `FOR SHARE` waits for a close in
-- flight and then reads the committed row, so a line and a close racing
-- cannot both win.
CREATE OR REPLACE FUNCTION timeoff.refuse_line_in_closed_period()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  closed timestamptz;
BEGIN
  SELECT closed_at INTO closed FROM timeoff.pay_period
   WHERE tenant_id = NEW.tenant_id AND id = NEW.period_id
   FOR SHARE;
  IF closed IS NOT NULL THEN
    RAISE EXCEPTION 'pay period % is closed; post the line to the next open one', NEW.period_id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER pay_period_line_open_period_only
  BEFORE INSERT ON timeoff.pay_period_line
  FOR EACH ROW EXECUTE FUNCTION timeoff.refuse_line_in_closed_period();

-- ------------------------------------------------------------------ grants --
--
-- Punches and lines are insert-only for the service; the REVOKE is spelled
-- out as on the ledger. `member_schedule` takes DELETE for an assignment
-- entered for a future date and withdrawn before it starts.
GRANT SELECT, INSERT, UPDATE         ON timeoff.kiosk_device    TO svc_timeoff;
GRANT SELECT, INSERT                 ON timeoff.punch           TO svc_timeoff;
REVOKE UPDATE, DELETE, TRUNCATE      ON timeoff.punch           FROM svc_timeoff;
GRANT SELECT, INSERT, UPDATE, DELETE ON timeoff.schedule        TO svc_timeoff;
GRANT SELECT, INSERT, DELETE         ON timeoff.member_schedule TO svc_timeoff;
GRANT SELECT, INSERT, UPDATE         ON timeoff.pay_period      TO svc_timeoff;
GRANT SELECT, INSERT                 ON timeoff.pay_period_line TO svc_timeoff;
REVOKE UPDATE, DELETE, TRUNCATE      ON timeoff.pay_period_line FROM svc_timeoff;
