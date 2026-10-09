-- Asking somebody for details, as one ask (Inbox C1, C7, C8, H2, H4, Z2):
-- the fields, what HR or the manager wrote, when it is due, and how it
-- ended. `people.detail_request` keeps its one row per field (the profile's
-- "asked for" and the email's daily cap); this is the ask the person sees as
-- a task and the sender tracks in their requests.
--
-- An ask to many people at once shares a `batch_id`, so the sender sees one
-- row with progress (H4). It is done when the person fills it in from their
-- Inbox (or when every field it asked for has a value, which is read); it can
-- also be sent back by the person with a reason, or cancelled by whoever sent
-- it.
--
-- `people.change_nudge` is the once-only nudge on a change waiting for HR
-- (E1): when the requester pressed it, so it is offered once, after 48 hours.
--
-- Expand only: three new tables.

CREATE TABLE people.detail_ask (
  tenant_id     uuid        NOT NULL,
  id            uuid        NOT NULL,
  person_id     uuid        NOT NULL,
  keys          text[]      NOT NULL,
  -- The sender's own words, shown to the person as they wrote them.
  message       text,
  due_on        date,
  requested_by  uuid        NOT NULL,
  requested_at  timestamptz NOT NULL,
  batch_id      uuid        NOT NULL,
  state         text        NOT NULL DEFAULT 'open',
  -- Sent back: why, as the person chose it, and what they wrote.
  reason        text,
  note          text,
  closed_by     uuid,
  closed_at     timestamptz,

  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, person_id) REFERENCES people.person (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT detail_ask_state_known CHECK (state IN ('open', 'done', 'sent_back', 'cancelled')),
  CONSTRAINT detail_ask_reason_known CHECK (
    reason IS NULL OR reason IN ('no_information', 'not_applicable', 'other')
  ),
  CONSTRAINT detail_ask_keys_given CHECK (cardinality(keys) > 0),
  CONSTRAINT detail_ask_closed CHECK ((state = 'open') = (closed_at IS NULL))
);

-- The person's To do, and the sender's requests, newest first.
CREATE INDEX detail_ask_person ON people.detail_ask (tenant_id, person_id, requested_at DESC);
CREATE INDEX detail_ask_sender ON people.detail_ask (tenant_id, requested_by, requested_at DESC);
CREATE INDEX detail_ask_batch ON people.detail_ask (tenant_id, batch_id);

ALTER TABLE people.detail_ask ENABLE ROW LEVEL SECURITY;
ALTER TABLE people.detail_ask FORCE  ROW LEVEL SECURITY;
CREATE POLICY detail_ask_tenant_isolation ON people.detail_ask
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- Questions on an ask (C7): the thread stays on the task, not in email.
CREATE TABLE people.detail_ask_message (
  tenant_id  uuid        NOT NULL,
  id         uuid        NOT NULL,
  ask_id     uuid        NOT NULL,
  -- The account that wrote it: the person asked, or whoever asked.
  author     uuid        NOT NULL,
  body       text        NOT NULL,
  at         timestamptz NOT NULL,

  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, ask_id) REFERENCES people.detail_ask (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT detail_ask_message_body CHECK (btrim(body) <> '' AND length(body) <= 4000)
);

CREATE INDEX detail_ask_message_ask ON people.detail_ask_message (tenant_id, ask_id, at);

ALTER TABLE people.detail_ask_message ENABLE ROW LEVEL SECURITY;
ALTER TABLE people.detail_ask_message FORCE  ROW LEVEL SECURITY;
CREATE POLICY detail_ask_message_tenant_isolation ON people.detail_ask_message
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE TABLE people.change_nudge (
  tenant_id  uuid        NOT NULL,
  change_id  uuid        NOT NULL,
  nudged_by  uuid        NOT NULL,
  at         timestamptz NOT NULL,

  PRIMARY KEY (tenant_id, change_id)
);

ALTER TABLE people.change_nudge ENABLE ROW LEVEL SECURITY;
ALTER TABLE people.change_nudge FORCE  ROW LEVEL SECURITY;
CREATE POLICY change_nudge_tenant_isolation ON people.change_nudge
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE ON people.detail_ask         TO svc_people;
GRANT SELECT, INSERT         ON people.change_nudge       TO svc_people;
GRANT SELECT, INSERT         ON people.detail_ask_message TO svc_people;
