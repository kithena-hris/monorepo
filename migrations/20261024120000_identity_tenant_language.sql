-- The company's language (`packages/contracts/src/language.ts`).
--
-- What every email from the company is written in, whatever language each of
-- its people chose for their own screens, and the language a screen starts in
-- for somebody who has not chosen one. Set in the back office. US English for
-- every company that has not been given another; the list of languages lives
-- in the code, so adding one is a deploy rather than a migration, and identity
-- refuses a code it does not know.
ALTER TABLE platform.tenant
  ADD COLUMN IF NOT EXISTS language text NOT NULL DEFAULT 'en-US';
