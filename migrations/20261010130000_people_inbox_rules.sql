-- The company's Inbox rules (Inbox P2): reminders and escalation, the default
-- due dates of what People asks of somebody, and when a failing integration
-- becomes every administrator's task. Kept beside the company's other
-- reminder rules in Settings > People > Organisation.
--
-- One JSON value rather than a column each: People validates its shape on
-- every write, and an absent key is the default, so a rule added later needs
-- no migration of its own. A constant default, so Postgres adds it without
-- rewriting the table.
--
-- Expand only.

ALTER TABLE people.tenant_settings
  ADD COLUMN inbox_rules jsonb NOT NULL DEFAULT '{}'::jsonb;
