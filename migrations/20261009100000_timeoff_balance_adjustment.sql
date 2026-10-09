-- A balance changed by hand (PRD §7.1's `adjustment`), with who asked and
-- who decided. HR's is approved as it is made and goes into the ledger then;
-- a manager's waits here, `pending`, until HR approves or declines it. The
-- ledger keeps the days; this keeps the asking, so "who gave me 2 days and
-- why" has an answer even for one that was declined.
--
-- Expand only: a new table, nothing read from it until this ships.
CREATE TABLE timeoff.balance_adjustment (
  tenant_id      uuid NOT NULL,
  -- UUIDv7, minted by the domain.
  id             uuid NOT NULL,
  person_id      uuid NOT NULL,
  leave_type_key text NOT NULL,
  -- Signed, in the leave type's unit, as the ledger's.
  amount         numeric(9,3) NOT NULL,
  effective_on   date NOT NULL,
  -- Why, in the words of whoever asked. Shown to the person beside the days.
  reason         text NOT NULL,
  proposed_by    text NOT NULL,
  proposed_at    timestamptz NOT NULL,
  status         text NOT NULL,
  decided_by     text,
  decided_at     timestamptz,
  -- Why it was declined, when HR said.
  note           text,
  -- The ledger row it became, once approved.
  entry_id       uuid,

  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, person_id) REFERENCES timeoff.member (tenant_id, person_id),
  CONSTRAINT balance_adjustment_status_known CHECK (status IN ('pending', 'approved', 'declined')),
  CONSTRAINT balance_adjustment_reason_given CHECK (btrim(reason) <> ''),
  CONSTRAINT balance_adjustment_not_zero CHECK (amount <> 0),
  CONSTRAINT balance_adjustment_decided CHECK ((status = 'pending') = (decided_by IS NULL))
);

-- HR's queue: what waits, oldest first.
CREATE INDEX balance_adjustment_waiting
  ON timeoff.balance_adjustment (tenant_id, proposed_at)
  WHERE status = 'pending';

ALTER TABLE timeoff.balance_adjustment ENABLE ROW LEVEL SECURITY;
ALTER TABLE timeoff.balance_adjustment FORCE  ROW LEVEL SECURITY;
CREATE POLICY balance_adjustment_tenant_isolation ON timeoff.balance_adjustment
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE ON timeoff.balance_adjustment TO svc_timeoff;
