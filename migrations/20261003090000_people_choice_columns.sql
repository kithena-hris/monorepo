-- A company's own employment types and work models.
--
-- `employment_type` and `work_model` held only People's values (permanent,
-- fixed term, contractor…; onsite, hybrid, remote), so a company whose people
-- are Full-time and Part-time could not say so, and an import made a second
-- field beside the real one. The values are now the published field's
-- options: People's own to start with, and whatever the company adds. The
-- write path validates a value against them, as it does every choice; the
-- row keeps only the shape of a key, which is what the analytics, the
-- requiredness predicates and the export compare.
--
-- Expand only: every row the old checks took, the new ones take.

ALTER TABLE people.person
  DROP CONSTRAINT person_employment_type_known,
  ADD CONSTRAINT person_employment_type_key CHECK (
    employment_type IS NULL OR employment_type ~ '^[a-z][a-z0-9_]{0,63}$'
  ),
  DROP CONSTRAINT person_work_model_known,
  ADD CONSTRAINT person_work_model_key CHECK (
    work_model IS NULL OR work_model ~ '^[a-z][a-z0-9_]{0,63}$'
  );
