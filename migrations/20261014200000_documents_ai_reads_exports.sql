-- Kithena reads a People export like any other document now (decided
-- 2026-10-14, PRD §14.1): every name, email, number and address in it becomes
-- a stand-in before a model sees it. Seeded companies had it off; switch it on
-- where it is still off. Data only, no shape change.
UPDATE documents.document_type
   SET definition = jsonb_set(definition, '{aiEnabled}', 'true')
 WHERE key = 'people_export' AND definition ->> 'aiEnabled' = 'false';
