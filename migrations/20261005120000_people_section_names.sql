-- Section names: one per company, and why the system published a version.
--
-- `SchemaDraft.addSection` refuses a live section whose name another live
-- section has (case and spacing ignored). Two transactions can each read a
-- draft without the other's section, so the database holds the rule too.
--
-- A trigger, not a unique index, and on purpose. Production already holds
-- duplicates (an import minted "Employment" beside the core one), which a
-- unique index would refuse to build, and migrations run before the service
-- whose boot job folds them (`fold-sections.ts`). The trigger checks only the
-- row being written, so the existing pairs neither block this migration nor
-- any write the fold makes (archiving one is never a clash), while a new name
-- that clashes is refused. The advisory lock is per tenant and per
-- transaction, so two concurrent writers of one company's sections take turns
-- and the second sees the first's committed row.
--
-- Expand only: a nullable column and a trigger. Nothing is read differently
-- and no row is changed.

ALTER TABLE people.schema_version ADD COLUMN reason text;

CREATE OR REPLACE FUNCTION people.section_name(labels jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$ SELECT lower(btrim(regexp_replace(labels->>'default', '\s+', ' ', 'g'))) $$;

CREATE OR REPLACE FUNCTION people.refuse_duplicate_section_name()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  clash text;
BEGIN
  IF NEW.archived_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.archived_at IS NULL
     AND people.section_name(OLD.labels) = people.section_name(NEW.labels) THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('people.section:' || NEW.tenant_id::text, 0));

  SELECT s.labels->>'default' INTO clash
    FROM people.section s
   WHERE s.tenant_id = NEW.tenant_id
     AND s.key <> NEW.key
     AND s.archived_at IS NULL
     AND people.section_name(s.labels) = people.section_name(NEW.labels)
   LIMIT 1;
  IF clash IS NOT NULL THEN
    RAISE EXCEPTION 'A section called "%" already exists', clash
      USING ERRCODE = 'unique_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER section_name_is_unique
  BEFORE INSERT OR UPDATE OF labels, archived_at ON people.section
  FOR EACH ROW EXECUTE FUNCTION people.refuse_duplicate_section_name();
