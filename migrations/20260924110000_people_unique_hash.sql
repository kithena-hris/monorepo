-- Unique claims hold a keyed hash, not the value (PEO-082).
--
-- `people.attribute_unique.normalised_value` held every unique value in
-- plaintext, so an encrypted attribute could not be unique without its
-- plaintext sitting next to its ciphertext — which is why no country pack
-- marked a national identifier unique. A claim is now HMAC-SHA-256 of the
-- normalised value under a key derived per tenant from the master key that
-- wraps `people.person_secret` (`services/people/src/infrastructure/unique.ts`).
-- The derived key is never in the database, in plaintext or otherwise;
-- `key_id` names the master key it came from.
--
-- Every attribute, not only encrypted ones: a plaintext index of employee
-- numbers is needless too.
--
-- ### Expand-contract, and where this file stops
--
-- Expand only. The hash column arrives nullable, `normalised_value` loses its
-- NOT NULL, and a row holds exactly one of the two. The backfill cannot be SQL,
-- because the key it needs is not in the database: the rotation job
-- (`claimRotation`, hourly, in `background.ts`) treats a row with no `key_id`
-- as stale, reads the value back from the person row or the secret store,
-- writes its hash and clears `normalised_value` in the same UPDATE. New code
-- writes only the hash, and checks the plaintext column only to find a claim
-- the backfill has not reached yet.
--
-- **Dropping `normalised_value` is a later migration, not this PR.** It is safe
-- once (a) no replica runs code older than this, which writes plaintext, and
-- (b) `SELECT count(*) FROM people.attribute_unique WHERE key_id IS NULL`
-- returns 0 in every environment after a rotation pass. Neither is knowable
-- when this file is applied. The contract step drops the column, the partial
-- index and the `attribute_unique_one_form` check, and makes `value_hash` and
-- `key_id` NOT NULL.
--
-- ### The key
--
-- The primary key was `(tenant_id, attribute_key, scope_id, normalised_value)`,
-- and a primary-key column cannot be null. It becomes
-- `(tenant_id, person_id, attribute_key)` — one claim per person per
-- attribute, which the claim path already guaranteed by releasing before it
-- claims — and uniqueness of the value moves to two indexes: the hash, and,
-- until the contract step, the plaintext of claims not yet backfilled.
--
-- The hash index compares hashes under one key. During a rotation a value can
-- be held under the old key and claimed under the new one, so the application
-- looks under every key the ring holds and takes a transaction-scoped advisory
-- lock per (tenant, attribute, scope) around the look and the write — every
-- rule a write claims under, sorted, before its first claim, so two writes
-- cannot deadlock on each other. The index is still what decides between two
-- writers under the same key.
--
-- A duplicate that predates a rotation — the re-keyed hash already held by
-- somebody else — is not re-keyed: the claim keeps its old key, `conflict_with`
-- names the other holder, and HR's grid lists the pair until one changes.

ALTER TABLE people.attribute_unique
  ADD COLUMN value_hash    bytea,
  ADD COLUMN key_id        text,
  -- Set by the rotation when this claim's value, re-keyed, is already held by
  -- somebody else under the current key: a duplicate that predates the
  -- rotation. The claim stays under the retiring key, so the value is still
  -- unique there, and HR's grid lists the pair until one of them changes.
  ADD COLUMN conflict_with uuid;

ALTER TABLE people.attribute_unique DROP CONSTRAINT attribute_unique_pkey;
ALTER TABLE people.attribute_unique ALTER COLUMN normalised_value DROP NOT NULL;
ALTER TABLE people.attribute_unique ADD PRIMARY KEY (tenant_id, person_id, attribute_key);

ALTER TABLE people.attribute_unique
  ADD CONSTRAINT attribute_unique_hash_key UNIQUE (tenant_id, attribute_key, scope_id, value_hash),
  -- The plaintext and the hash are never side by side: that pair is exactly
  -- what this migration exists to stop.
  ADD CONSTRAINT attribute_unique_one_form CHECK ((value_hash IS NULL) <> (normalised_value IS NULL)),
  ADD CONSTRAINT attribute_unique_hash_has_key CHECK ((value_hash IS NULL) = (key_id IS NULL)),
  ADD CONSTRAINT attribute_unique_hash_is_sha256 CHECK (value_hash IS NULL OR octet_length(value_hash) = 32),
  -- Whoever the conflict is with can be deleted without taking this claim.
  ADD CONSTRAINT attribute_unique_conflict_with_person
    FOREIGN KEY (tenant_id, conflict_with) REFERENCES people.person (tenant_id, id)
    ON DELETE SET NULL (conflict_with);

-- HR's grid lists conflicts; almost every row has none.
CREATE INDEX attribute_unique_conflict_idx
  ON people.attribute_unique (tenant_id) WHERE conflict_with IS NOT NULL;

-- Claims not yet backfilled stay unique on what they hold. Dropped with the column.
CREATE UNIQUE INDEX attribute_unique_legacy_value_idx
  ON people.attribute_unique (tenant_id, attribute_key, scope_id, normalised_value)
  WHERE normalised_value IS NOT NULL;

-- The isolation form from 20260922140000_people_bootstrap.sql, restated
-- because this table changed shape; both statements are idempotent and the
-- policy from 20260922170000 stands unchanged.
ALTER TABLE people.attribute_unique ENABLE ROW LEVEL SECURITY;
ALTER TABLE people.attribute_unique FORCE  ROW LEVEL SECURITY;

-- UPDATE for the rotation, on the columns it rewrites and nothing else: a
-- claim's tenant, attribute, scope and holder are never edited in place.
GRANT UPDATE (value_hash, key_id, normalised_value, conflict_with) ON people.attribute_unique TO svc_people;
