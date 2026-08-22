-- Whoever runs the back-office.
--
-- A third population, and the smallest: tens of people, ever, all of them ours.
-- It gets its own tables rather than borrowing the tenant ones, because an
-- operator is not an employee of anybody and putting one inside the row-level
-- security model as if they were would mean inventing a tenant for them.
--
-- What it *does* borrow is `platform.identity` and `platform.credential`, which
-- already carry no tenant. One human, one passkey, whatever they are doing.

CREATE TABLE platform.operator (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_id uuid NOT NULL REFERENCES platform.identity (id),

  -- Used to recognise a person in an audit trail, never to authenticate them.
  email       text NOT NULL,

  status      text NOT NULL DEFAULT 'invited',

  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT operator_status_known CHECK (status IN ('invited', 'active', 'suspended')),
  CONSTRAINT operator_email_shape CHECK (position('@' in email) > 1)
);

CREATE UNIQUE INDEX operator_identity_key ON platform.operator (identity_id);
CREATE UNIQUE INDEX operator_email_key ON platform.operator (lower(email));

-- No row-level security on either table in this file, and the reason is that
-- there is nothing to scope by. An operator belongs to no tenant; that is the
-- whole point of the back-office and also what makes it the most dangerous
-- surface in the product. What constrains it is that every read it performs is
-- logged, and that reaching it at all requires a credential nobody else holds.

CREATE TABLE platform.operator_session (
  id           uuid PRIMARY KEY,
  operator_id  uuid NOT NULL REFERENCES platform.operator (id) ON DELETE CASCADE,

  started_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),

  -- An hour idle and a working day absolute, enforced by the reader. Far
  -- shorter than an employee's thirty days: the population is small, salaried
  -- and at a desk, so every reason to be generous with a session length is
  -- absent here.
  expires_at   timestamptz NOT NULL,

  ip           inet,
  user_agent   text,

  revoked_at   timestamptz
);

CREATE INDEX operator_session_expiry_idx ON platform.operator_session (expires_at);

CREATE TRIGGER operator_touch_updated_at
  BEFORE UPDATE ON platform.operator
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();
