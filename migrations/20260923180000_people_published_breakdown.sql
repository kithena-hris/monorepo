-- Published special-category breakdowns (PEO-083, §16.1 rule 2).
--
-- The cohort minimum holds on one reading and leaks across two: "disclosed a
-- disability" 14 on Monday and 15 on Tuesday is whoever started on Tuesday. So
-- a special-category breakdown is never served from the daily snapshot. The
-- snapshot job publishes one here — at most once per calendar month, and only
-- once as many people as the cohort minimum changed since the last — and every
-- read serves the latest row, rounded to the nearest 5.
--
-- ### Aggregates only
--
-- True counts per bucket and the population, as the snapshot measure table
-- already holds them, and the instant of publication. Nothing per person. The
-- "how many changed since" count reads `people.person_attribute_history`,
-- where each answer already sits with the instant it was recorded; the answer
-- in force at publication is the latest recorded before `published_at`. A
-- second copy of anybody's answer is exactly what this table must not become.
--
-- True rather than rounded counts, because the minimum is checked on the true
-- counts at read time — a tenant that raises its minimum after a publication
-- has it applied to that publication, too.
--
-- ### One per month, by the key
--
-- `month` is in the primary key, so two replicas racing the same run cannot
-- both publish: the second insert conflicts and does nothing.

CREATE TABLE people.published_breakdown (
  tenant_id    uuid NOT NULL,
  -- `self_id:<attribute key>` or `composition:<dimension>`.
  measure      text NOT NULL,
  -- The first of the calendar month `published_on` falls in.
  month        date NOT NULL,
  -- The snapshot day the counts come from.
  published_on date NOT NULL,
  -- When it was published: the line between "changed before" and "since".
  published_at timestamptz NOT NULL,
  population   int NOT NULL,
  -- `[{ "bucket": …, "count": n }]` or `[{ "keys": […], "count": n }]`.
  cells        jsonb NOT NULL,

  PRIMARY KEY (tenant_id, measure, month),

  CONSTRAINT published_breakdown_month_is_its_month CHECK (
    month = published_on - (extract(day FROM published_on)::int - 1)
  ),
  CONSTRAINT published_breakdown_population_not_negative CHECK (population >= 0),
  CONSTRAINT published_breakdown_cells_is_a_list CHECK (jsonb_typeof(cells) = 'array')
);

ALTER TABLE people.published_breakdown ENABLE ROW LEVEL SECURITY;
ALTER TABLE people.published_breakdown FORCE  ROW LEVEL SECURITY;
CREATE POLICY published_breakdown_tenant_isolation ON people.published_breakdown
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- Append-only: a publication is what was shown, and is never rewritten.
GRANT SELECT, INSERT ON people.published_breakdown TO svc_people;
