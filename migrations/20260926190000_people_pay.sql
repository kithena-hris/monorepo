-- Pay bands and pay in aggregate (PEO-078, PRD §16.2).
--
-- ### Pay bands
--
-- Minimum, midpoint and maximum per grade and currency, from a day. People
-- keeps them until a Compensation module takes them over, and each change is a
-- `people.pay_band.set` or `.corrected` event in the same transaction, so that
-- module can replay them. HR or finance maintains them.
--
-- Append-only. A band from a new day is a new row; a correction to a day
-- already recorded is a new row for the same grade, currency and day that
-- `supersedes` the old one, and the later `recorded_at` wins. What was
-- recorded, by whom and when is never rewritten.
--
-- ### Pay in aggregate
--
-- The nightly snapshot reads each present person's salary — decrypting it in
-- memory where the field is sealed — and writes quartiles per group here, and
-- nothing per person: not a salary, not a person id, not a grade beside a
-- person. A group is one currency. A group below the tenant's cohort minimum
-- is a row with no count and no figure, and the CHECK holds the floor of ten,
-- so a path that skips the domain cannot store a median of three either.
--
-- Every run is audited in `pay_snapshot_audit`: when, by what, how many
-- salaries it read and how many of those it had to decrypt. Never a value.

CREATE TABLE people.pay_band (
  tenant_id      uuid          NOT NULL,
  id             uuid          NOT NULL,
  grade          text          NOT NULL,
  currency       char(3)       NOT NULL,
  minimum        numeric(19,4) NOT NULL,
  midpoint       numeric(19,4) NOT NULL,
  maximum        numeric(19,4) NOT NULL,
  effective_from date          NOT NULL,
  supersedes     uuid,
  recorded_at    timestamptz   NOT NULL,
  recorded_by    uuid          NOT NULL,

  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, supersedes) REFERENCES people.pay_band (tenant_id, id),
  CONSTRAINT pay_band_grade_length CHECK (char_length(grade) BETWEEN 1 AND 64 AND grade = btrim(grade)),
  CONSTRAINT pay_band_currency_code CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT pay_band_ordered CHECK (minimum > 0 AND minimum <= midpoint AND midpoint <= maximum)
);

CREATE INDEX pay_band_in_force_idx
  ON people.pay_band (tenant_id, grade, currency, effective_from DESC, recorded_at DESC);

ALTER TABLE people.pay_band ENABLE ROW LEVEL SECURITY;
ALTER TABLE people.pay_band FORCE  ROW LEVEL SECURITY;
CREATE POLICY pay_band_tenant_isolation ON people.pay_band
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT ON people.pay_band TO svc_people;

CREATE TABLE people.pay_snapshot (
  tenant_id uuid    NOT NULL,
  day       date    NOT NULL,
  -- `grade`: salary per grade. `tenure`: salary per tenure band.
  -- `compa`: salary over the band midpoint, per grade.
  measure   text    NOT NULL,
  bucket    text    NOT NULL,
  currency  char(3) NOT NULL,
  -- Null, with every figure, for a group below the cohort minimum.
  people    int,
  -- Money in major units for `grade` and `tenure`; a ratio for `compa`.
  p25       numeric(19,4),
  median    numeric(19,4),
  p75       numeric(19,4),

  PRIMARY KEY (tenant_id, day, measure, bucket, currency),
  CONSTRAINT pay_snapshot_measure_known CHECK (measure IN ('grade', 'tenure', 'compa')),
  CONSTRAINT pay_snapshot_cohort_floor CHECK (people IS NULL OR people >= 10),
  CONSTRAINT pay_snapshot_withheld_whole CHECK (
    (people IS NULL AND p25 IS NULL AND median IS NULL AND p75 IS NULL)
    OR (people IS NOT NULL AND p25 IS NOT NULL AND median IS NOT NULL AND p75 IS NOT NULL)
  )
);

ALTER TABLE people.pay_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE people.pay_snapshot FORCE  ROW LEVEL SECURITY;
CREATE POLICY pay_snapshot_tenant_isolation ON people.pay_snapshot
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- A re-run of the same day replaces that day's rows.
GRANT SELECT, INSERT, DELETE ON people.pay_snapshot TO svc_people;

CREATE TABLE people.pay_snapshot_audit (
  tenant_id     uuid        NOT NULL,
  id            uuid        NOT NULL,
  day           date        NOT NULL,
  taken_at      timestamptz NOT NULL,
  -- `system:<process>` for the nightly job; an account id if a person ran it.
  taken_by      text        NOT NULL,
  -- Salaries read in memory, and how many of those were decrypted to read.
  values_read   int         NOT NULL,
  values_sealed int         NOT NULL,
  groups        int         NOT NULL,
  withheld      int         NOT NULL,

  PRIMARY KEY (tenant_id, id),
  CONSTRAINT pay_snapshot_audit_counts CHECK (
    values_read >= 0 AND values_sealed BETWEEN 0 AND values_read
    AND groups >= 0 AND withheld BETWEEN 0 AND groups
  )
);

ALTER TABLE people.pay_snapshot_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE people.pay_snapshot_audit FORCE  ROW LEVEL SECURITY;
CREATE POLICY pay_snapshot_audit_tenant_isolation ON people.pay_snapshot_audit
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- Append-only: an audit row is what happened.
GRANT SELECT, INSERT ON people.pay_snapshot_audit TO svc_people;
