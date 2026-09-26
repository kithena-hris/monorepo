-- Scheduled reports (PEO-069, PRD §16.3): a file or a summary, on a cadence,
-- to named recipients, through platform/messaging — the email carries a link
-- to the tenant app, never the data.
--
-- ### A schedule holds no result and no person
--
-- The audience is a saved segment or a filter, the recipients are accounts,
-- and every run builds the report again as each recipient, at send time. So
-- a recipient gets what they could have exported or charted themselves that
-- morning, and one who has since left or lost the right gets nothing.
--
-- `segment_id` is not a foreign key: a segment is deleted by its owner and
-- nothing about that should fail. A run over a segment that has gone is
-- recorded as skipped instead.
--
-- ### A run per period, not a timer
--
-- `last_period` is the calendar date of the last occurrence run (or the one
-- current when the schedule was made or resumed, so it never sends the moment
-- it is saved). The backend sleeps when idle, so the hourly sweep asks "has a
-- period come that has not run" and sends only the latest; the ones it covers
-- are counted in `missed`. `report_run`'s key is the idempotency: two
-- replicas, or a sweep re-run after a crash, claim a period once.

CREATE TABLE people.report_schedule (
  tenant_id         uuid        NOT NULL,
  id                uuid        NOT NULL,
  name              text        NOT NULL,
  owner_account_id  uuid        NOT NULL,
  segment_id        uuid,
  -- Attribute key → the value it must equal; '{}' is everybody the recipient may list.
  filter            jsonb       NOT NULL DEFAULT '{}'::jsonb,
  kind              text        NOT NULL,
  format            text,
  -- Attribute keys; NULL is every field the recipient may read.
  fields            text[],
  reason            text,
  every             text        NOT NULL,
  weekday           smallint,
  day_of_month      smallint,
  hour              smallint    NOT NULL,
  legal_entity_id   uuid,
  recipients        uuid[]      NOT NULL,
  paused            boolean     NOT NULL DEFAULT false,
  last_period       date        NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT report_schedule_name CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  CONSTRAINT report_schedule_filter CHECK (jsonb_typeof(filter) = 'object'),
  CONSTRAINT report_schedule_kind CHECK (
    (kind = 'export' AND format IN ('xlsx', 'pdf'))
    OR (kind = 'summary' AND format IS NULL AND fields IS NULL AND reason IS NULL AND filter = '{}'::jsonb)
  ),
  CONSTRAINT report_schedule_cadence CHECK (
    hour BETWEEN 0 AND 23 AND (
      (every = 'day'   AND weekday IS NULL AND day_of_month IS NULL)
      OR (every = 'week'  AND weekday BETWEEN 1 AND 7 AND day_of_month IS NULL)
      OR (every = 'month' AND weekday IS NULL AND day_of_month BETWEEN 1 AND 28)
    )
  ),
  CONSTRAINT report_schedule_recipients CHECK (cardinality(recipients) BETWEEN 1 AND 25),
  CONSTRAINT report_schedule_reason CHECK (reason IS NULL OR char_length(reason) <= 500)
);

-- What each run did: per recipient, an outcome code and never a value, a
-- link or an address.
CREATE TABLE people.report_run (
  tenant_id    uuid        NOT NULL,
  schedule_id  uuid        NOT NULL,
  period       date        NOT NULL,
  -- Earlier periods this run covers, slept through.
  missed       integer     NOT NULL DEFAULT 0 CHECK (missed >= 0),
  started_at   timestamptz NOT NULL,
  finished_at  timestamptz,
  -- 'sent' | 'partial' | 'failed' | 'skipped'; NULL while running.
  outcome      text CHECK (outcome IS NULL OR outcome IN ('sent', 'partial', 'failed', 'skipped')),
  -- [{ "accountId": uuid, "outcome": "sent" | "failed" | "not_eligible" | <refusal code> }]
  -- or, for a skipped run, [{ "outcome": <why> }].
  recipients   jsonb       NOT NULL DEFAULT '[]'::jsonb,
  PRIMARY KEY (tenant_id, schedule_id, period),
  FOREIGN KEY (tenant_id, schedule_id)
    REFERENCES people.report_schedule (tenant_id, id) ON DELETE CASCADE
);

ALTER TABLE people.report_schedule ENABLE ROW LEVEL SECURITY;
ALTER TABLE people.report_schedule FORCE  ROW LEVEL SECURITY;
CREATE POLICY report_schedule_tenant_isolation ON people.report_schedule
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE people.report_run ENABLE ROW LEVEL SECURITY;
ALTER TABLE people.report_run FORCE  ROW LEVEL SECURITY;
CREATE POLICY report_run_tenant_isolation ON people.report_run
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON people.report_schedule TO svc_people;
GRANT SELECT, INSERT, UPDATE ON people.report_run TO svc_people;

-- ### The kind `messaging.delivery` records it under
--
-- Widened, as 20260924120100 did, when messaging's table is in this database.
DO $$
BEGIN
  IF to_regclass('messaging.delivery') IS NOT NULL THEN
    ALTER TABLE messaging.delivery DROP CONSTRAINT IF EXISTS delivery_kind_known;
    ALTER TABLE messaging.delivery ADD CONSTRAINT delivery_kind_known CHECK (
      kind IN ('account_invitation', 'profile_reminder', 'webhook_disabled', 'scheduled_report')
    );
  END IF;
END
$$;
