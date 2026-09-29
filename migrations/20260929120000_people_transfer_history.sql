-- Import & export share one history (design V6): what each import was and
-- what each export held, so the screen can list them without guessing.
--
-- `people.import.name`: the file's name as it was uploaded, written when the
-- import is claimed. A name somebody chose for a spreadsheet, never a value in
-- it; the file itself stays where 20260923130000 put it, nowhere.
--
-- `people.export.format`, `reason`, `attribute_keys`: written when the export
-- completes, the same three facts `people.export.completed` already carries
-- on the outbox. The reason is the requester's own sentence, required for a
-- financial export; keys name fields, never values.
--
-- Expand only: nullable columns, no backfill. A row written before this has
-- none, and the history says less about it rather than inventing it. The
-- existing grants are table-wide (SELECT, INSERT, UPDATE to svc_people), so the
-- new columns need none of their own.

ALTER TABLE people.import
  ADD COLUMN name text
  CONSTRAINT import_name_bounded CHECK (name IS NULL OR length(name) BETWEEN 1 AND 255);

ALTER TABLE people.export
  ADD COLUMN format text
  CONSTRAINT export_format_known CHECK (format IS NULL OR format IN ('csv', 'xlsx', 'pdf'));

ALTER TABLE people.export
  ADD COLUMN reason text
  CONSTRAINT export_reason_bounded CHECK (reason IS NULL OR length(reason) BETWEEN 1 AND 500);

ALTER TABLE people.export
  ADD COLUMN attribute_keys text[];
