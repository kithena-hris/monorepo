-- Saved segments (PEO-068, PRD §16.3): a named filter, shareable within the
-- tenant, used by the directory, the export builder and analytics.
--
-- A row holds the filter and never who matched it. Whoever uses a segment
-- gets the people they may list that match it, and a key they may not filter
-- or chart by is refused at use — the same checks a filter typed by hand
-- meets. So a segment saved by HR and shared cannot show a manager anybody
-- outside their chain, and there is no stored list of people to go stale,
-- retain or erase.
--
-- A segment is changed by saving another and deleting this one: nothing
-- points at a segment yet (scheduled reports will, PEO-069), so a delete
-- removes the row.

CREATE TABLE people.segment (
  tenant_id         uuid        NOT NULL,
  id                uuid        NOT NULL,
  name              text        NOT NULL,
  -- Attribute key → the value it must equal, as the directory filters.
  filter            jsonb       NOT NULL,
  owner_account_id  uuid        NOT NULL,
  shared            boolean     NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT segment_name_length CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  CONSTRAINT segment_filter_object CHECK (jsonb_typeof(filter) = 'object' AND filter <> '{}'::jsonb)
);

-- One name per owner, so a picker never offers two "Madrid" of one person's.
CREATE UNIQUE INDEX segment_owner_name ON people.segment (tenant_id, owner_account_id, lower(name));

ALTER TABLE people.segment ENABLE ROW LEVEL SECURITY;
ALTER TABLE people.segment FORCE  ROW LEVEL SECURITY;
CREATE POLICY segment_tenant_isolation ON people.segment
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, DELETE ON people.segment TO svc_people;
