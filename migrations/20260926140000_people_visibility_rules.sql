-- Custom visibility rules on an attribute definition (PEO-066, PRD §6.6).
--
-- The draft's copy of `visibilityRules`: presets a scope may also read the
-- field under, each on the records a closed predicate holds for. Null when an
-- attribute has none, which is every attribute today — the contract keeps
-- the key absent rather than empty, so a published document written before
-- this column existed keeps its checksum. Published versions carry the rules
-- in `schema_version.document` and need nothing here.
--
-- Expand only: nullable, no default, no backfill, so the ALTER takes its lock
-- for a catalogue change and never rewrites the table.

ALTER TABLE people.attribute_definition ADD COLUMN visibility_rules jsonb;
