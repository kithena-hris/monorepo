-- Identity: accounts, credentials and sessions.
--
-- Four tables and an outbox, all in `platform`. Two of them deliberately carry
-- no row-level security, and the reasoning for that is the most important thing
-- in this file, so it is stated where the tables are rather than in a document.

-- ---------------------------------------------------------------- identity --
--
-- One human, worldwide. It holds almost nothing on purpose.
--
-- A contractor working for three customers is ONE row here and three rows in
-- `account`, which is what lets them carry one passkey across all three
-- employers. Names, emails and employment live in the People module, on the
-- other side of a boundary this service may not cross.
--
-- This id is also the WebAuthn `userHandle`. That value is stored in plain text
-- on the authenticator and syncs to the vendor's cloud, so it must stay an
-- opaque uuid: an email or an employee number here leaks the employment
-- relationship to anyone who dumps a synced keychain.
CREATE TABLE platform.identity (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- -------------------------------------------------------------- credential --
--
-- Passkeys and federated links, belonging to the human rather than the job.
--
-- No `tenant_id`, and therefore no row-level security — there is nothing for a
-- policy to compare against. That is not an oversight, it is what "one passkey,
-- several employers" costs.
--
-- It does mean this table knows that one person works for both Acme and Globex,
-- which is something neither employer is entitled to learn. RLS cannot protect
-- that, so the protection has to be structural: `identity` and `credential` are
-- never reachable from a tenant-facing API. Every tenant-facing read goes
-- through `account`, which is scoped. Anything that widens that is a privacy
-- incident, not a refactor.
CREATE TABLE platform.credential (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_id uuid NOT NULL REFERENCES platform.identity (id),

  kind        text NOT NULL,

  -- The WebAuthn credential id, or the issuer's `sub`. Never an email: emails
  -- are reassigned when people leave, and a stable identifier that is recycled
  -- is worse than no identifier at all.
  external_id text NOT NULL,

  -- The authenticator's AAGUID, or the OIDC issuer. Part of the identity of the
  -- credential, which is why it is in the uniqueness below: two issuers can
  -- legitimately mint the same `sub`.
  provider    text NOT NULL DEFAULT '',

  public_key  bytea,

  -- WebAuthn's replay counter. A value that goes backwards means a cloned
  -- authenticator; syncable passkeys report zero and are exempt.
  sign_count  bigint NOT NULL DEFAULT 0,

  -- Whether the authenticator can leave the device that created it. Decides
  -- whether a tenant enforcing hardware-bound authenticators may accept it.
  backed_up   boolean NOT NULL DEFAULT false,

  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,

  -- Soft. A removed credential still explains a session that existed.
  revoked_at   timestamptz,

  CONSTRAINT credential_kind_known CHECK (kind IN ('passkey', 'federated', 'password'))
);

-- Partial, so revoking a credential frees its identifier for re-registration.
-- Without `WHERE revoked_at IS NULL`, removing a passkey and enrolling the same
-- authenticator again would collide with the tombstone.
CREATE UNIQUE INDEX credential_external_key
  ON platform.credential (kind, provider, external_id)
  WHERE revoked_at IS NULL;

CREATE INDEX credential_identity_idx ON platform.credential (identity_id);

-- ----------------------------------------------------------------- account --
--
-- One human at one company. The unit access is granted against, and the
-- aggregate root the four-device rule belongs to.
CREATE TABLE platform.account (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES platform.tenant (id),
  identity_id uuid NOT NULL REFERENCES platform.identity (id),

  status      text NOT NULL DEFAULT 'provisioned',

  -- Used once, to route an invitation. Never an identifier afterwards.
  work_email  text NOT NULL,

  -- IANA zone. A start date and a last working day are calendar dates, and
  -- "has the 1st arrived" has no answer without knowing whose calendar. Ending
  -- access at UTC midnight logs Californians out mid-afternoon.
  time_zone   text NOT NULL,

  employment_start date NOT NULL,

  -- Tenant policy. Regulated customers ask for two; a company issuing shared
  -- terminals asks for more. The ceiling exists so a misconfiguration cannot
  -- turn the cap off entirely.
  session_limit smallint NOT NULL DEFAULT 4,

  -- Optimistic concurrency for the aggregate.
  version     integer NOT NULL DEFAULT 0,

  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT account_status_known CHECK (
    status IN ('provisioned', 'invited', 'active', 'suspended', 'terminated')
  ),
  CONSTRAINT account_session_limit_sane CHECK (session_limit BETWEEN 1 AND 16)
);

-- Rehire, and the reason both of these are partial.
--
-- A person leaves in 2026 and comes back in 2028. The terminated row stays —
-- employment records outlive employment — so a plain unique index on
-- (tenant, email) would make the rehire fail, or worse, would be worked around
-- by creating a second identity and splitting one person's history in two.
--
-- Excluding terminated rows means the old account keeps its history and the new
-- one gets the email back. Lower-cased because `A@acme.com` and `a@acme.com`
-- are the same mailbox to every mail server that will ever deliver to it.
CREATE UNIQUE INDEX account_live_email_key
  ON platform.account (tenant_id, lower(work_email))
  WHERE status <> 'terminated';

CREATE UNIQUE INDEX account_live_identity_key
  ON platform.account (tenant_id, identity_id)
  WHERE status <> 'terminated';

CREATE INDEX account_identity_idx ON platform.account (identity_id);

-- ----------------------------------------------------------------- session --
--
-- One signed-in device, holding a numbered slot.
CREATE TABLE platform.session (
  id           uuid PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES platform.tenant (id),

  -- ON DELETE CASCADE is for the test fixtures and for a tenant genuinely
  -- erased under a retention policy. Terminating an employee never deletes an
  -- account, so it never reaches this.
  account_id   uuid NOT NULL REFERENCES platform.account (id) ON DELETE CASCADE,

  slot         smallint NOT NULL,

  started_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),

  -- Absolute, not extended by activity. Idle expiry is a separate comparison
  -- against `last_seen_at`.
  expires_at   timestamptz NOT NULL,

  -- RFC 8176 authentication methods. What the policy floor is audited against.
  amr          text[] NOT NULL DEFAULT '{}',

  -- Personal data, all three. Classified `internal`/`contact` in the contract,
  -- which is what puts them in a DSAR export and keeps them out of a model
  -- prompt. The address is truncated once the forensics window has passed: a
  -- full address is a home address for anyone working remotely.
  ip           inet,
  user_agent   text,
  aaguid       text,

  -- The cap, and the only part of it that a race cannot get past.
  --
  -- Counting rows and then inserting is a check-then-act with a gap in the
  -- middle; two logins a millisecond apart both count four and both insert a
  -- fifth. This index closes that gap: the loser gets a unique violation and
  -- retries. The domain decides *which* slot and what to evict, the index makes
  -- a duplicate impossible.
  --
  -- The per-tenant limit itself is not expressible here — a CHECK cannot read
  -- another table — so the ceiling below is an absolute bound and
  -- `session_limit` is enforced in the domain above it.
  CONSTRAINT session_slot_sane CHECK (slot BETWEEN 1 AND 16)
);

CREATE UNIQUE INDEX session_slot_key ON platform.session (account_id, slot);
CREATE INDEX session_expiry_idx ON platform.session (expires_at);

-- ------------------------------------------------------------------ outbox --
--
-- The write and its event commit together. Debezium tails the WAL from here.
CREATE TABLE platform.outbox (
  event_id       uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL,
  event_name     text NOT NULL,
  event_version  text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id   text NOT NULL,
  partition_key  text NOT NULL,
  envelope       jsonb NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX outbox_created_idx ON platform.outbox (created_at);

-- -------------------------------------------------------- row-level security
--
-- Two details decide whether a policy enforces anything, and SECURITY.md says
-- both. FORCE, because a table's owner bypasses its own policies otherwise and
-- a service connects as a role that may own its schema. And NULLIF, because
-- `set_config(..., true)` returns to the empty string rather than to unset at
-- the end of a transaction — `''::uuid` raises 22P02, so the obvious form turns
-- every unscoped query into a 500 from a cast instead of a quiet "no rows".
--
-- WITH CHECK as well as USING. Reading is half of isolation; without it a
-- tenant can insert a row it will then be unable to see.

ALTER TABLE platform.account ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.account FORCE  ROW LEVEL SECURITY;
CREATE POLICY account_tenant_isolation ON platform.account
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE platform.session ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.session FORCE  ROW LEVEL SECURITY;
CREATE POLICY session_tenant_isolation ON platform.session
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE platform.outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.outbox FORCE  ROW LEVEL SECURITY;
CREATE POLICY outbox_tenant_isolation ON platform.outbox
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE TRIGGER account_touch_updated_at
  BEFORE UPDATE ON platform.account
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();
