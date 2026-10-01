-- A view saved from a search (smart search's "Save as view"): a segment may
-- hold the directory's own conditions, and whether all or any must hold,
-- beside or instead of its key = value filter. Still a filter and never a
-- result: the directory authorizes the conditions as the person using the
-- view, when they use it, exactly as typed ones.
--
-- Expand only. Both columns are nullable and every existing row keeps its
-- filter; the check that a segment is not everybody now counts conditions
-- too, which relaxes it, so code that writes a filter alone is unaffected.

ALTER TABLE people.segment
  ADD COLUMN conditions jsonb,
  ADD COLUMN match      text;

ALTER TABLE people.segment
  ADD CONSTRAINT segment_conditions_list CHECK (conditions IS NULL OR jsonb_typeof(conditions) = 'array'),
  ADD CONSTRAINT segment_match_known     CHECK (match IS NULL OR match IN ('all', 'any'));

ALTER TABLE people.segment DROP CONSTRAINT segment_filter_object;
ALTER TABLE people.segment
  ADD CONSTRAINT segment_filter_object CHECK (
    jsonb_typeof(filter) = 'object'
    AND (filter <> '{}'::jsonb OR jsonb_array_length(coalesce(conditions, '[]'::jsonb)) > 0)
  );
