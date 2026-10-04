-- How many people a request to send an export covers (design E5: "Export to
-- Nora Becker · 6 people").
--
-- Expand only. `people` is the number of people in the file as the requester
-- read it when they asked: the same count the send panel showed them, taken
-- in the same transaction that writes the request. A file is built only once
-- it is approved, so nothing else knows it. Null on every row written before;
-- no backfill, because the count is of what the requester could read then and
-- cannot be recomputed exactly now, and Review then says nothing rather than
-- a guess.

ALTER TABLE people.export_share ADD COLUMN people integer;

ALTER TABLE people.export_share
  ADD CONSTRAINT export_share_people_counted CHECK (people IS NULL OR people >= 0);
