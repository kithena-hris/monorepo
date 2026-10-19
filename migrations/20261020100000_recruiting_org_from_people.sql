-- Recruiting: where a location or a department came from (Recruiting PRD
-- §5.2). With People present, its legal entities, locations and org units
-- reach Recruiting as events and are listed in its settings as People's,
-- edited there and not here; without People, Recruiting keeps its own short
-- lists. A legal entity carries the same mark inside its `body`.
--
-- Expand only: a default, so every row written so far is Recruiting's own.

ALTER TABLE recruiting.location
  ADD COLUMN source text NOT NULL DEFAULT 'recruiting' CHECK (source IN ('recruiting', 'people'));

ALTER TABLE recruiting.org_unit
  ADD COLUMN source text NOT NULL DEFAULT 'recruiting' CHECK (source IN ('recruiting', 'people'));
