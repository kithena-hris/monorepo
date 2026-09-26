-- Changes held for approval (PEO-077, PRD §8.6).
--
-- A write to a field that requires approval — a bank account, a salary, a
-- national identifier, or whatever a tenant switched on — is recorded here
-- and not applied: the person's row, their history, their secrets, exports
-- and PDFs go on holding the value in force. HR decides within seven days;
-- the requester may withdraw it; undecided, it expires. An approval applies
-- the value through the ordinary write path, from the `effective_from` kept
-- here, in the transaction that records the decision.
--
-- A value is held in one of two ways, never both:
--   * `value`, as the write path took it, for an attribute stored in clear;
--   * `ciphertext` under the secrets' key ring, with `last4` for display, for
--     an encrypted one. The ciphertext is dropped the moment the change is
--     closed — applied, rejected, withdrawn or expired — so a backup of a
--     decided change holds its last four and nothing that opens.
--
-- Every close is a guarded UPDATE on `state`, so two deciders, or a decision
-- racing an expiry, cannot both win. No DELETE: the rows are the audit trail,
-- beside the events on the outbox.
--
-- `requires_approval` on the draft is the tenant's choice for a field; null
-- is the default, computed from its policy (on for financial or encrypted).
-- Expand only: nullable, no default, no backfill.

ALTER TABLE people.attribute_definition ADD COLUMN requires_approval boolean;

CREATE TABLE people.pending_change (
  tenant_id       uuid NOT NULL,
  id              uuid NOT NULL,
  person_id       uuid NOT NULL,
  attribute_key   text NOT NULL,
  kind            text NOT NULL,
  sealed          boolean NOT NULL,
  value           jsonb,
  ciphertext      bytea,
  key_id          text,
  last4           text,
  -- The history row a correction replaces.
  supersedes      uuid,
  effective_from  date NOT NULL,
  requested_by    uuid NOT NULL,
  requested_at    timestamptz NOT NULL,
  -- A correction's stated reason; a plain change has none.
  reason          text,
  expires_at      timestamptz NOT NULL,
  state           text NOT NULL DEFAULT 'pending',
  decided_by      uuid,
  decided_at      timestamptz,
  note            text,

  PRIMARY KEY (tenant_id, id),
  CONSTRAINT pending_change_kind CHECK (kind IN ('value', 'correction')),
  CONSTRAINT pending_change_corrects CHECK ((kind = 'correction') = (supersedes IS NOT NULL)),
  CONSTRAINT pending_change_state CHECK (
    state IN ('pending', 'approved', 'rejected', 'withdrawn', 'expired')
  ),
  CONSTRAINT pending_change_reason_bounded CHECK (reason IS NULL OR length(reason) <= 500),
  CONSTRAINT pending_change_note_bounded CHECK (note IS NULL OR length(note) <= 500),
  -- Nobody decides their own request; the domain refuses it, and so does this.
  -- A withdrawal is the requester's own, and is recorded as theirs.
  CONSTRAINT pending_change_not_self_decided CHECK (
    decided_by IS NULL OR state = 'withdrawn' OR decided_by <> requested_by
  ),
  CONSTRAINT pending_change_decided_whole CHECK (
    (state IN ('approved', 'rejected', 'withdrawn')) = (decided_by IS NOT NULL AND decided_at IS NOT NULL)
  ),
  -- A sealed value is never in `value`, and its ciphertext lives only while pending.
  CONSTRAINT pending_change_sealed_apart CHECK (NOT sealed OR value IS NULL),
  CONSTRAINT pending_change_cipher_whole CHECK ((ciphertext IS NULL) = (key_id IS NULL)),
  CONSTRAINT pending_change_cipher_sealed CHECK (ciphertext IS NULL OR sealed),
  CONSTRAINT pending_change_cipher_while_pending CHECK (ciphertext IS NULL OR state = 'pending')
);

-- A record's open changes, for its profile; the tenant's, oldest first, for the inbox.
CREATE INDEX pending_change_person_open
  ON people.pending_change (tenant_id, person_id) WHERE state = 'pending';
CREATE INDEX pending_change_open
  ON people.pending_change (tenant_id, requested_at) WHERE state = 'pending';

-- The isolation form from 20260922140000_people_bootstrap.sql, unchanged.
ALTER TABLE people.pending_change ENABLE ROW LEVEL SECURITY;
ALTER TABLE people.pending_change FORCE  ROW LEVEL SECURITY;
CREATE POLICY pending_change_tenant_isolation ON people.pending_change
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE ON people.pending_change TO svc_people;
