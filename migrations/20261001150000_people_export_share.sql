-- An export sent to somebody else (design AI13, AI14, MA10).
--
-- Two additions, both expand-only.
--
-- **The ledger learns where a file went and what it said.** `shared_with` is
-- the account it was sent to: that account, and the requester, are the only
-- ones `GET /v1/exports/{id}` answers, and its files live under `shared/` for
-- seven days rather than a day. `opened_at` is the recipient's first open.
-- `as_of` and `audience` are what the file's About sheet and the Recorded
-- panel say — the date and the builder's own words for who is in it, never a
-- name from it. Null on every row written before; the screens then say less.
--
-- **A request to send waits here** when the file would hold more than its
-- recipient could read themselves: a field they cannot see on somebody in it,
-- or somebody they cannot list. A People administrator who is neither the
-- requester nor the recipient approves sending that one file, or not. What it
-- holds is what to build (field keys, a date, the directory's conditions) and
-- what the recipient could not read (keys and counts) — never a value. The
-- file is built only once it is approved, and `export_id` then names it.

ALTER TABLE people.export
  ADD COLUMN shared_with uuid,
  ADD COLUMN opened_at   timestamptz,
  ADD COLUMN as_of       date,
  ADD COLUMN audience    text;

CREATE TABLE people.export_share (
  tenant_id    uuid        NOT NULL,
  id           uuid        NOT NULL,
  requested_by uuid        NOT NULL,
  recipient    uuid        NOT NULL,
  reason       text        NOT NULL,
  requested_at timestamptz NOT NULL,
  expires_at   timestamptz NOT NULL,
  state        text        NOT NULL,
  decided_by   uuid,
  decided_at   timestamptz,
  note         text,
  -- What to build: fields, date, format, audience. Never a value.
  choice       jsonb       NOT NULL,
  -- What the recipient could not read: field keys and counts.
  gap          jsonb       NOT NULL,
  export_id    uuid,

  PRIMARY KEY (tenant_id, id),
  CONSTRAINT export_share_state CHECK (
    state IN ('pending', 'approved', 'rejected', 'expired', 'withdrawn')
  ),
  CONSTRAINT export_share_not_to_self CHECK (recipient <> requested_by),
  CONSTRAINT export_share_decided_whole CHECK ((decided_by IS NULL) = (decided_at IS NULL)),
  CONSTRAINT export_share_sent_once_approved CHECK (export_id IS NULL OR state = 'approved')
);

CREATE UNIQUE INDEX export_share_export_idx
  ON people.export_share (tenant_id, export_id) WHERE export_id IS NOT NULL;

-- The isolation form from 20260922140000_people_bootstrap.sql, unchanged.
ALTER TABLE people.export_share ENABLE ROW LEVEL SECURITY;
ALTER TABLE people.export_share FORCE  ROW LEVEL SECURITY;
CREATE POLICY export_share_tenant_isolation ON people.export_share
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- No DELETE: a request is kept as the export ledger is.
GRANT SELECT, INSERT, UPDATE ON people.export_share TO svc_people;
