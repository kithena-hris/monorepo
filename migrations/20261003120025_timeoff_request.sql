-- Leave requests and the decisions on them (PRD §8, §9, TOF-031).
--
-- Two live requests for one member cannot cover the same day, and the
-- database says so: two browser tabs, a retried POST and a phone sending at
-- the same moment all pass the domain's check, because each looked before the
-- other wrote. An exclusion constraint is the only check that sees both.

-- `uuid WITH =` inside a GiST exclusion needs `btree_gist`. A trusted
-- extension, like `btree_gin` and `pg_trgm`: the database owner creates it,
-- `migrator` on the VM and the owner role on Neon. `init-db.sql` already has
-- it locally.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ----------------------------------------------------------------- request --
CREATE TABLE timeoff.request (
  tenant_id         uuid NOT NULL,
  id                uuid NOT NULL,
  person_id         uuid NOT NULL,
  leave_type_key    text NOT NULL,
  status            text NOT NULL DEFAULT 'pending',

  -- The days off, as a set of date ranges. One range for an ordinary
  -- request; several after a counter-proposal that swapped a clash day out
  -- (T18: 19, 20, 22, 23 and 26 Oct), where the bounds would claim the 21st
  -- the member chose to work. `range_merge(days)` gives the bounds.
  days              datemultirange NOT NULL,
  starts_half_day   boolean NOT NULL DEFAULT false,
  ends_half_day     boolean NOT NULL DEFAULT false,
  working_days      numeric(9,3) NOT NULL,

  -- The verdict `goingBelowZero` reached when it was sent (§7.4).
  below_zero        boolean NOT NULL DEFAULT false,
  -- To the approver. Free text.
  note              text,
  -- Special-category health data (§8.5): a reference to the encrypted file,
  -- never its content, and never in an event.
  sick_note_file_id uuid,

  -- Up to three `Proposal`s while `counter_proposed`, else empty.
  proposals         jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- The new `Span` while `change_pending`. The old days stay booked, and stay
  -- in `days`, until the change is approved (§8.4).
  pending_change    jsonb,
  -- The event that set the current days, which the next change supersedes.
  dates_event_id    uuid,

  -- The aggregate's version, for optimistic concurrency.
  version           integer NOT NULL DEFAULT 0,
  requested_at      timestamptz NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, person_id) REFERENCES timeoff.member (tenant_id, person_id),
  FOREIGN KEY (tenant_id, leave_type_key) REFERENCES timeoff.leave_type (tenant_id, key),

  CONSTRAINT request_status_known CHECK (status IN (
    'draft', 'pending', 'approved', 'taken', 'change_pending',
    'declined', 'counter_proposed', 'withdrawn', 'cancelled'
  )),
  CONSTRAINT request_has_days CHECK (NOT isempty(days)),
  CONSTRAINT request_working_days_not_negative CHECK (working_days >= 0),
  CONSTRAINT request_proposals_is_an_array CHECK (jsonb_typeof(proposals) = 'array'),
  CONSTRAINT request_change_only_while_pending CHECK (
    pending_change IS NULL OR status = 'change_pending'
  ),

  -- Live requests for one member never share a day. Live is every state that
  -- still claims its days: a counter-proposed request goes back to pending if
  -- the member keeps their dates, and a taken one was taken.
  --
  -- ponytail: a morning off and an afternoon off on the same date overlap
  -- here. The domain has no morning/afternoon yet; when it does, the half-day
  -- boundary becomes part of the key.
  CONSTRAINT request_no_overlap EXCLUDE USING gist (
    tenant_id WITH =,
    person_id WITH =,
    days      WITH &&
  ) WHERE (status IN ('pending', 'approved', 'change_pending', 'counter_proposed', 'taken'))
);

-- "My requests" and "Waiting for me".
CREATE INDEX request_person_idx ON timeoff.request (tenant_id, person_id, status);

ALTER TABLE timeoff.request ENABLE ROW LEVEL SECURITY;
ALTER TABLE timeoff.request FORCE  ROW LEVEL SECURITY;
CREATE POLICY request_tenant_isolation ON timeoff.request
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE TRIGGER request_touch_updated_at
  BEFORE UPDATE ON timeoff.request
  FOR EACH ROW EXECUTE FUNCTION timeoff.touch_updated_at();

-- The ledger's `request_id`, now that there is a request to point at.
ALTER TABLE timeoff.ledger_entry
  ADD CONSTRAINT ledger_entry_request_fk
  FOREIGN KEY (tenant_id, request_id) REFERENCES timeoff.request (tenant_id, id);

-- -------------------------------------------------------- request_decision --
--
-- Who decided what, step by step: a manager-then-HR chain is two rows. A
-- delegate's decision names the approver it stood in for (§9.7), which is
-- how the timeline says "for Marco, who's away". Append-only.
CREATE TABLE timeoff.request_decision (
  tenant_id    uuid NOT NULL,
  id           uuid NOT NULL,
  request_id   uuid NOT NULL,
  outcome      text NOT NULL,
  -- The role this step filled in the chain.
  role         text NOT NULL,
  -- The account that decided.
  decided_by   uuid NOT NULL,
  -- The approver a delegate decided for; null when they decided themselves.
  on_behalf_of uuid,
  reason       text,
  decided_at   timestamptz NOT NULL,
  -- The outbox event this decision raised.
  event_id     uuid,

  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, request_id) REFERENCES timeoff.request (tenant_id, id),

  CONSTRAINT request_decision_outcome_known CHECK (outcome IN (
    'approved', 'declined', 'counter_proposed', 'change_approved', 'change_declined'
  )),
  CONSTRAINT request_decision_role_known CHECK (role IN ('manager', 'hr'))
);

CREATE INDEX request_decision_request_idx
  ON timeoff.request_decision (tenant_id, request_id, decided_at);

ALTER TABLE timeoff.request_decision ENABLE ROW LEVEL SECURITY;
ALTER TABLE timeoff.request_decision FORCE  ROW LEVEL SECURITY;
CREATE POLICY request_decision_tenant_isolation ON timeoff.request_decision
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- ------------------------------------------------------------------ grants --
--
-- No DELETE on a request: a withdrawn one is a state, and the ledger names it.
GRANT SELECT, INSERT, UPDATE ON timeoff.request          TO svc_timeoff;
GRANT SELECT, INSERT         ON timeoff.request_decision TO svc_timeoff;
