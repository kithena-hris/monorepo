-- The contract stage, between the accepted offer and the hire.
--
-- An accepted offer moves its application here; the contract is prepared,
-- checked and signed in this stage, and the signature moves it on to the
-- hired stage. A job's pipeline from before gains the stage the first time
-- one of its offers is accepted (`withContractStage`), so no row is rewritten
-- here: only the category a stage may have is widened.
ALTER TABLE recruiting.stage DROP CONSTRAINT IF EXISTS stage_category_check;
ALTER TABLE recruiting.stage
  ADD CONSTRAINT stage_category_check CHECK (category IN (
    'applied', 'screening', 'interview', 'assessment', 'works_council', 'offer', 'contract', 'hired'
  ));
