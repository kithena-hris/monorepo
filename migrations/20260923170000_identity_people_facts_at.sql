-- When People last corrected this account's name and start date.
--
-- Identity keeps a copy of both (docs/people-prd.md §5): the WebAuthn prompt
-- shows the name, and enrolment is gated on the start date. Once a person
-- exists, People is the source of record and corrects the copy with
-- `people.person.identity_facts_changed`.
--
-- Each of those events carries whole values, and one person's events arrive in
-- commit order on their partition, so ordinary redelivery ends on the newest
-- value. This column covers the case that ordering does not: an old event
-- published again out of band, such as a dead-letter replay. The consumer
-- writes the event's `occurredAt` here and refuses any event that is not
-- newer, so a replayed correction cannot put back a name or a date that has
-- since changed.
--
-- Null means People has never corrected the account. That is every account
-- written before this migration, and permanently every account in a tenant
-- without the People module, where identity's own values are the only truth.
--
-- Expand only: nullable, no backfill, nothing reads it but the consumer.
-- `svc_identity` holds table-level UPDATE on `platform` through the default
-- privileges in `tools/scripts/init-db.sql`, and that covers a new column.

ALTER TABLE platform.account
  ADD COLUMN IF NOT EXISTS people_facts_at timestamptz;

COMMENT ON COLUMN platform.account.people_facts_at IS
  'occurredAt of the last People event applied to the cached name and start date. Null: never corrected by People.';
