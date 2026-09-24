-- Every unique-claim lookup is a key lookup.
--
-- 20260924340000 has the mechanism: for a tenant the statistics have not seen,
-- the planner expects the tenant to hold no rows, and any index that starts
-- with `tenant_id` then looks as cheap as the key. On `people.attribute_unique`
-- every index started with `tenant_id`, and a claim runs two lookups a row:
--
--   * the release, `tenant_id, person_id, attribute_key`: the primary key.
--     `attribute_unique_hash_key` won it on its `(tenant_id, attribute_key)`
--     prefix and walked every claim the import had made on that attribute.
--   * the check for the value, by hash or by the legacy plaintext. It walked
--     the same prefix, through the hash key or the primary key.
--
-- 500 new people claiming a work email read 230,850 index entries; 1,000 read
-- 980,350.
--
-- So the value indexes lead with the value, and only the primary key starts
-- with `tenant_id`. The release's columns are the primary key and it can use
-- no other index. The value check's leading column is in neither of the other
-- two indexes; it still competes with the primary key's `tenant_id` prefix, and
-- `unique.ts` probes one value per arm rather than `= ANY(…)`, which the
-- planner prices as ten descents and loses to that prefix.
--
-- The uniqueness each index enforces is unchanged: the same columns, so the
-- same rows collide. The hash key stays a constraint.
--
--   * `attribute_unique_person_idx (tenant_id, person_id)` is a prefix of the
--     primary key, which serves "which claims does this person hold" as well.
--   * Rotation, `rolloutSkipped` and the conflicts grid read by tenant, which
--     the primary key and `attribute_unique_conflict_idx` still serve.
--
-- Expand-contract: each replacement exists, and enforces, before its original
-- goes; nothing refers to an index by name.

CREATE UNIQUE INDEX IF NOT EXISTS attribute_unique_value_key
  ON people.attribute_unique (value_hash, tenant_id, attribute_key, scope_id);
ALTER TABLE people.attribute_unique
  ADD CONSTRAINT attribute_unique_value_key UNIQUE USING INDEX attribute_unique_value_key;
ALTER TABLE people.attribute_unique DROP CONSTRAINT IF EXISTS attribute_unique_hash_key;

CREATE UNIQUE INDEX IF NOT EXISTS attribute_unique_legacy_key
  ON people.attribute_unique (normalised_value, tenant_id, attribute_key, scope_id)
  WHERE normalised_value IS NOT NULL;
DROP INDEX IF EXISTS people.attribute_unique_legacy_value_idx;

DROP INDEX IF EXISTS people.attribute_unique_person_idx;
