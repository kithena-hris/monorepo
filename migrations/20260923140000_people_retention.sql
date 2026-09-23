-- Retention that actually erases (PEO-037, PEO-085).
--
-- A leaver's values are cleared on a schedule per classification, and until
-- now two places could not be cleared at all: an encrypted value, because
-- `svc_people` had no DELETE on `people.person_secret`, and the history,
-- because `people.person_attribute_history` refuses every UPDATE and DELETE.
-- A retention job that leaves the value in history has anonymised the
-- projection and kept the truth, which is the half that matters.
--
-- Additive only: one grant, two nullable columns, a column-scoped grant and a
-- trigger function replaced with a strict superset of the old rule.

-- ----------------------------------------------------------- person_secret --
--
-- DELETE, and nothing else changes. `person_secret_tenant_isolation` was
-- created without a `FOR` clause, so it already applies to every command,
-- DELETE included: a delete aimed at another tenant's secret matches no row.
GRANT DELETE ON people.person_secret TO svc_people;

-- ------------------------------------------------ person_attribute_history --
--
-- ### The one change history may undergo
--
-- Redaction: `value` becomes NULL, `redacted_at` and `redaction_reason` are
-- stamped, once. Nothing else — not the key, not either date, not the actor,
-- not `supersedes`, not the event id — and never a DELETE. The row survives,
-- so the timeline still says a fact was recorded on that date by that actor;
-- only what the fact was is gone.
--
-- ### Why the trigger, not a SECURITY DEFINER function
--
-- Both would work. The trigger is the smaller safe one:
--
--   - It already guards every write to this table, for every role including
--     the owner. Widening it by exactly one shape keeps a single place that
--     decides what history may do. A definer function would be a second door
--     the trigger would still have to be taught to let through.
--   - A SECURITY DEFINER function runs as its owner; one missed tenant
--     setting or search_path slip and it is a privileged path out of tenant
--     isolation. The trigger runs as the caller, so RLS applies exactly as it
--     does to every other statement `svc_people` makes.
--   - The grant is column-scoped: `svc_people` may UPDATE `value`,
--     `redacted_at` and `redaction_reason` and no other column, so the shape
--     check below is the second of two locks.
--
-- No new table, so no new RLS policy: `history_tenant_isolation` has no `FOR`
-- clause and already covers UPDATE, USING and WITH CHECK, in the form
-- 20260922140000_people_bootstrap.sql sets out.

ALTER TABLE people.person_attribute_history
  ADD COLUMN redacted_at      timestamptz,
  ADD COLUMN redaction_reason text;

-- Both or neither, and a redacted row holds no value. Every existing row has
-- both NULL, which satisfies the check.
ALTER TABLE people.person_attribute_history
  ADD CONSTRAINT history_redaction_is_whole CHECK (
    (redacted_at IS NULL AND redaction_reason IS NULL)
    OR (redacted_at IS NOT NULL AND redaction_reason IS NOT NULL AND value IS NULL)
  ),
  ADD CONSTRAINT history_redaction_reason_known CHECK (
    redaction_reason IS NULL OR redaction_reason = 'retention'
  );

CREATE OR REPLACE FUNCTION people.refuse_history_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     -- Once. A redacted row is final.
     AND OLD.redacted_at IS NULL
     AND NEW.redacted_at IS NOT NULL
     AND NEW.redaction_reason IS NOT NULL
     AND NEW.value IS NULL
     -- Everything else exactly as it was.
     AND NEW.id             IS NOT DISTINCT FROM OLD.id
     AND NEW.tenant_id      IS NOT DISTINCT FROM OLD.tenant_id
     AND NEW.person_id      IS NOT DISTINCT FROM OLD.person_id
     AND NEW.attribute_key  IS NOT DISTINCT FROM OLD.attribute_key
     AND NEW.effective_from IS NOT DISTINCT FROM OLD.effective_from
     AND NEW.recorded_at    IS NOT DISTINCT FROM OLD.recorded_at
     AND NEW.actor          IS NOT DISTINCT FROM OLD.actor
     AND NEW.supersedes     IS NOT DISTINCT FROM OLD.supersedes
     AND NEW.event_id       IS NOT DISTINCT FROM OLD.event_id
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'people.person_attribute_history is append-only; write a correction carrying supersedes'
    USING ERRCODE = 'restrict_violation';
END $$;

GRANT UPDATE (value, redacted_at, redaction_reason)
  ON people.person_attribute_history TO svc_people;
