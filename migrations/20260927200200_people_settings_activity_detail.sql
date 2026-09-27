-- What a settings change did, in one plain sentence beside its title: "Everyone
-- signing up must fill it in", "Seen by HR and their manager". Words only,
-- never a value somebody entered, as for the rest of the log. Nullable: the
-- entries before it have none, and expand-contract never rewrites them.
ALTER TABLE people.settings_activity
  ADD COLUMN detail text
  CONSTRAINT settings_activity_detail CHECK (detail IS NULL OR length(detail) <= 500);
