-- Message delivery: what was sent, to whom, and what happened to it.
--
-- ### What is deliberately not here
--
-- No message body, no subject, and above all no link. The enrolment link is the
-- one secret that passes through the messaging service, and
-- `platform.enrolment_token` goes to the trouble of storing only its SHA-256
-- precisely so that a backup, a replica or a support query yields nothing
-- usable. A rendered message in a table would undo that in one column, and it
-- would be the easy thing to add.
--
-- What is here is the outcome: who it was for, which kind of message, which
-- provider took it, what the provider called it, and how it ended. That is what
-- HR needs in order to answer "did the invitation go out", and it is what an
-- operator needs when the answer is no.
--
-- ### Why a schema of its own
--
-- One schema per service, the same rule modules follow. `svc_messaging` can see
-- this and nothing else, so a cross-schema read fails at the database rather
-- than in review. It is not `platform` because messaging is not identity: the
-- whole reason the two are separate processes is that one holds the signing key
-- and the other holds a third party's API key.

CREATE SCHEMA IF NOT EXISTS messaging;

CREATE TABLE messaging.delivery (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Whose message. RLS is keyed on this, so a support query scoped to one
  -- customer cannot read another's.
  tenant_id   uuid NOT NULL,

  -- What kind of message. An enum rather than free text: this is read by an
  -- operator filtering a list, and a value somebody typed is a value nobody
  -- can filter on.
  kind        text NOT NULL,

  -- The address it was sent to.
  --
  -- Personal data, and kept anyway, because it is the whole point: "we sent it
  -- to grace.hopper@acme.exmaple" is how a typo is found, and a hash would make
  -- this table unable to answer the only question it exists for. It is
  -- classified as contact data in the registry and carried by the retention job
  -- like any other.
  to_email    text NOT NULL,

  -- Which transport took it, and what it called the message. The provider id is
  -- the only thread between a line in our logs and a row in someone else's
  -- dashboard when a message did not arrive.
  provider    text NOT NULL,
  provider_message_id text,

  -- Where it got to. `accepted` is what we know at send time and nothing more:
  -- a provider queueing a message is not a mailbox receiving one. The rest
  -- arrive later, by webhook.
  status      text NOT NULL,

  -- Why not, when the answer is no. A closed set from the send path or the
  -- provider's own event, never a message we pass through — a provider's error
  -- string quotes the address it refused.
  reason      text,

  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT delivery_kind_known CHECK (
    kind IN ('account_invitation')
  ),
  CONSTRAINT delivery_status_known CHECK (
    status IN ('accepted', 'delivered', 'bounced', 'complained', 'suppressed', 'failed')
  )
);

-- The webhook's lookup path. A provider event names the message and nothing
-- else, so this is how it finds the row to update. Partial, because a row with
-- no provider id is one the log transport wrote and no webhook will ever name.
CREATE UNIQUE INDEX delivery_provider_message_key
  ON messaging.delivery (provider, provider_message_id)
  WHERE provider_message_id IS NOT NULL;

-- "What has happened for this customer lately", which is the only way anybody
-- reads this table. Keyset-friendly, and it is the ordering an operator wants.
CREATE INDEX delivery_tenant_recent_idx
  ON messaging.delivery (tenant_id, created_at DESC);

-- The question HR actually asks: did this person's invitation arrive?
CREATE INDEX delivery_recipient_idx ON messaging.delivery (tenant_id, to_email);

-- -------------------------------------------------------- row-level security
--
-- FORCE, because a table's owner bypasses its own policies otherwise. NULLIF,
-- because `set_config(..., true)` returns to the empty string rather than to
-- unset at the end of a transaction, and `''::uuid` raises 22P02 — the obvious
-- form turns every unscoped query into a 500 from a cast instead of a quiet
-- "no rows". Both are what SECURITY.md insists on.
--
-- WITH CHECK as well as USING: reading is half of isolation, and without it a
-- tenant can insert a row it will then be unable to see.
ALTER TABLE messaging.delivery ENABLE ROW LEVEL SECURITY;
ALTER TABLE messaging.delivery FORCE  ROW LEVEL SECURITY;
CREATE POLICY delivery_tenant_isolation ON messaging.delivery
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE TRIGGER delivery_touch_updated_at
  BEFORE UPDATE ON messaging.delivery
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

-- ---------------------------------------------------------- webhook lookups --
--
-- A provider event arrives with a message id and no tenant, because the
-- provider has never heard of our tenants. Finding the row therefore has to
-- cross every tenant, which is exactly what the policy above forbids — and
-- correctly, since the alternative is the webhook route setting `app.tenant_id`
-- to whatever it likes.
--
-- SECURITY DEFINER, scoped to one lookup by one provider message id, returning
-- only the row's own tenant. It cannot enumerate, cannot filter, and cannot see
-- a body because there is none to see. The same shape as
-- `platform.tenant_account_counts()`, and for the same reason.
CREATE OR REPLACE FUNCTION messaging.delivery_tenant_of(
  p_provider text,
  p_message_id text
)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
-- Pinned, because a SECURITY DEFINER function that resolves names through the
-- caller's `search_path` runs the caller's tables with our privileges.
SET search_path = messaging, pg_temp
STABLE
AS $$
  SELECT tenant_id
    FROM messaging.delivery
   WHERE provider = p_provider
     AND provider_message_id = p_message_id
   LIMIT 1;
$$;

REVOKE ALL ON FUNCTION messaging.delivery_tenant_of(text, text) FROM PUBLIC;

-- ------------------------------------------------------------------- role --
--
-- Created here if it does not already exist, and that is not tidiness — it is
-- the difference between this migration applying and taking the whole deploy
-- down with it.
--
-- Roles are cluster-level, so `GRANT ... TO svc_messaging` fails outright
-- against any database where nobody has created the role first: the scratch
-- container `migrate lint` replays into, a fresh staging branch, and production
-- on the day this first runs. Atlas reports it as
--
--     Error: executing statement: pq: role "svc_messaging" does not exist
--
-- and every deploy step after the migration is skipped. `svc_identity` hit
-- exactly this and the identity and web deploys were silently skipped for a
-- day; `vercel-production.yml` still carries the comment. Creating the role
-- here means the migration is self-sufficient wherever it runs.
--
-- NOLOGIN, and no password. A password in a migration is a credential in the
-- repository, and this file is committed. The operator grants LOGIN with a
-- password out of band — Neon's console for the managed environments,
-- `tools/scripts/init-db.sql` locally, which creates it with LOGIN before any
-- migration runs and so takes the branch below that does nothing.
--
-- Failing to do that is loud rather than silent: the service cannot connect at
-- all, which is a boot failure, not a delivery log that quietly records
-- nothing.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'svc_messaging') THEN
    -- NOBYPASSRLS spelled out although it is the default, because it is the
    -- whole point of the role: `messaging.delivery` carries a tenant policy,
    -- and a role that ignores it would let one customer's support query read
    -- another's. Neon's default owner carries BYPASSRLS, which is why this is
    -- never the owner.
    CREATE ROLE svc_messaging NOLOGIN NOBYPASSRLS;
  END IF;
END $$;

-- ------------------------------------------------------------------ grants --
--
-- The service connects as `svc_messaging` and can reach this schema and nothing
-- else.
GRANT USAGE ON SCHEMA messaging TO svc_messaging;
GRANT SELECT, INSERT, UPDATE ON messaging.delivery TO svc_messaging;
-- No DELETE. A delivery record is an audit trail; retention removes it on a
-- schedule, not a service on a whim.
GRANT EXECUTE ON FUNCTION messaging.delivery_tenant_of(text, text) TO svc_messaging;
