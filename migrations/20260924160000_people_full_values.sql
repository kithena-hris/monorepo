-- Requests for full values: finance asks, HR decides, one download (PEO-088).
--
-- §15.2 used to let finance export an encrypted value by stating a reason.
-- The product decision replaces that: finance never downloads a sensitive
-- value directly. A request is a row here; HR's decision, the expiry of an
-- undecided request after seven days, the one file an approval issues and the
-- one download it allows are all changes to that row, each made by a guarded
-- UPDATE so two deciders — or two clicks on the same link — cannot both win.
--
-- What is held is who asked, why, which fields, who decided and when, and
-- whether the download was spent. Never a value, and never the link: the link
-- is re-signed from the file name and the expiry, so this table in a backup
-- opens nothing. The same facts are events on the outbox; the row is what the
-- guarded updates race on.

CREATE TABLE people.full_values_request (
  tenant_id        uuid NOT NULL,
  id               uuid NOT NULL,
  requested_by     uuid NOT NULL,
  requested_at     timestamptz NOT NULL,
  reason           text NOT NULL,
  attribute_keys   text[] NOT NULL,
  -- What the export covers: a past day, a selection, the filter as described.
  as_of            date,
  person_ids       uuid[],
  filter           text,
  expires_at       timestamptz NOT NULL,
  state            text NOT NULL DEFAULT 'pending',
  decided_by       uuid,
  decided_at       timestamptz,
  note             text,
  -- Set when an approval issues its one file.
  export_id        uuid,
  file_name        text,
  link_issued_at   timestamptz,
  link_expires_at  timestamptz,
  downloaded_at    timestamptz,

  PRIMARY KEY (tenant_id, id),
  CONSTRAINT full_values_state CHECK (state IN ('pending', 'approved', 'rejected', 'expired')),
  CONSTRAINT full_values_reason_stated CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
  CONSTRAINT full_values_note_bounded CHECK (note IS NULL OR length(note) <= 500),
  CONSTRAINT full_values_some_fields CHECK (cardinality(attribute_keys) > 0),
  -- Nobody decides their own request; the domain refuses it, and so does this.
  CONSTRAINT full_values_not_self_decided CHECK (decided_by IS NULL OR decided_by <> requested_by),
  CONSTRAINT full_values_decided_whole CHECK (
    (state IN ('approved', 'rejected')) = (decided_by IS NOT NULL AND decided_at IS NOT NULL)
  ),
  -- Only an approval issues a file, and a download needs an issued file.
  CONSTRAINT full_values_issued_when_approved CHECK (export_id IS NULL OR state = 'approved'),
  CONSTRAINT full_values_issued_whole CHECK (
    (export_id IS NULL) = (file_name IS NULL)
    AND (export_id IS NULL) = (link_issued_at IS NULL)
    AND (export_id IS NULL) = (link_expires_at IS NULL)
  ),
  CONSTRAINT full_values_downloaded_after_issue CHECK (downloaded_at IS NULL OR export_id IS NOT NULL)
);

-- The isolation form from 20260922140000_people_bootstrap.sql, unchanged.
ALTER TABLE people.full_values_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE people.full_values_request FORCE  ROW LEVEL SECURITY;
CREATE POLICY full_values_request_tenant_isolation ON people.full_values_request
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- No DELETE: a request, its decision and its download are the audit trail.
GRANT SELECT, INSERT, UPDATE ON people.full_values_request TO svc_people;
