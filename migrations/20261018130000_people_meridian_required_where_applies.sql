-- Meridian Freight (the demo company) was imported with 55 of its 100 fields
-- required of everybody, so 1,001 people each showed a dozen gaps that do not
-- apply to them: a leave type for people at work, an hourly rate for salaried
-- staff, an IBAN in the US. As the company asked (18 Oct 2026), each such field
-- is required only where it applies, or not at all where it is optional by
-- nature, read from the person's status, pay type, work authorisation or home
-- country.
--
-- Written to the company's draft (`people.attribute_definition`), never to a
-- published version: the administrator publishes it from Settings › People ›
-- Fields, with People's own preview of what it changes. Every rule was parsed
-- with `Requiredness` from `@kithena/contracts` before it was written here.

UPDATE people.attribute_definition AS d
   SET requiredness = r.requiredness
  FROM (VALUES
    ('annual_base_salary', '{"mode":"conditional","when":{"combine":"all","clauses":[{"operand":"attribute","key":"pay_type","is":"equals","equals":"salaried"}]},"requiredFrom":null,"appliesTo":"all_records"}'::jsonb),
    ('bank_account_number', '{"mode":"conditional","when":{"combine":"any","clauses":[{"operand":"attribute","key":"home_country","is":"equals","equals":"US"},{"operand":"attribute","key":"home_country","is":"equals","equals":"CA"},{"operand":"attribute","key":"home_country","is":"equals","equals":"IN"}]},"requiredFrom":null,"appliesTo":"all_records"}'::jsonb),
    ('driver_license_class', '{"mode":"never"}'::jsonb),
    ('driver_license_expiry', '{"mode":"never"}'::jsonb),
    ('driver_license_number', '{"mode":"never"}'::jsonb),
    ('flsa_status', '{"mode":"conditional","when":{"combine":"any","clauses":[{"operand":"attribute","key":"home_country","is":"equals","equals":"US"}]},"requiredFrom":null,"appliesTo":"all_records"}'::jsonb),
    ('home_address_line_2', '{"mode":"never"}'::jsonb),
    ('home_state_province', '{"mode":"conditional","when":{"combine":"any","clauses":[{"operand":"attribute","key":"home_country","is":"equals","equals":"US"},{"operand":"attribute","key":"home_country","is":"equals","equals":"IN"},{"operand":"attribute","key":"home_country","is":"equals","equals":"DE"},{"operand":"attribute","key":"home_country","is":"equals","equals":"CA"}]},"requiredFrom":null,"appliesTo":"all_records"}'::jsonb),
    ('hourly_rate', '{"mode":"conditional","when":{"combine":"all","clauses":[{"operand":"attribute","key":"pay_type","is":"equals","equals":"hourly"}]},"requiredFrom":null,"appliesTo":"all_records"}'::jsonb),
    ('hr_notes_category', '{"mode":"never"}'::jsonb),
    ('iban', '{"mode":"conditional","when":{"combine":"any","clauses":[{"operand":"attribute","key":"home_country","is":"equals","equals":"DE"},{"operand":"attribute","key":"home_country","is":"equals","equals":"GB"},{"operand":"attribute","key":"home_country","is":"equals","equals":"ES"}]},"requiredFrom":null,"appliesTo":"all_records"}'::jsonb),
    ('laptop_serial', '{"mode":"never"}'::jsonb),
    ('last_performance_review_date', '{"mode":"never"}'::jsonb),
    ('leave_type', '{"mode":"conditional","when":{"combine":"all","clauses":[{"operand":"status","in":["on_leave"]}]},"requiredFrom":null,"appliesTo":"all_records"}'::jsonb),
    ('parking_spot', '{"mode":"never"}'::jsonb),
    ('passport_expiry', '{"mode":"never"}'::jsonb),
    ('passport_number', '{"mode":"never"}'::jsonb),
    ('retirement_plan', '{"mode":"conditional","when":{"combine":"any","clauses":[{"operand":"attribute","key":"home_country","is":"equals","equals":"US"},{"operand":"attribute","key":"home_country","is":"equals","equals":"IN"},{"operand":"attribute","key":"home_country","is":"equals","equals":"DE"},{"operand":"attribute","key":"home_country","is":"equals","equals":"CA"},{"operand":"attribute","key":"home_country","is":"equals","equals":"GB"}]},"requiredFrom":null,"appliesTo":"all_records"}'::jsonb),
    ('routing_sort_ifsc_code', '{"mode":"conditional","when":{"combine":"any","clauses":[{"operand":"attribute","key":"home_country","is":"equals","equals":"US"},{"operand":"attribute","key":"home_country","is":"equals","equals":"CA"},{"operand":"attribute","key":"home_country","is":"equals","equals":"IN"}]},"requiredFrom":null,"appliesTo":"all_records"}'::jsonb),
    ('shift', '{"mode":"never"}'::jsonb),
    ('signature', '{"mode":"never"}'::jsonb),
    ('tax_filing_status', '{"mode":"conditional","when":{"combine":"any","clauses":[{"operand":"attribute","key":"home_country","is":"equals","equals":"US"},{"operand":"attribute","key":"home_country","is":"equals","equals":"IN"},{"operand":"attribute","key":"home_country","is":"equals","equals":"DE"},{"operand":"attribute","key":"home_country","is":"equals","equals":"GB"}]},"requiredFrom":null,"appliesTo":"all_records"}'::jsonb),
    ('tax_id_steuer_id', '{"mode":"conditional","when":{"combine":"any","clauses":[{"operand":"attribute","key":"home_country","is":"equals","equals":"DE"}]},"requiredFrom":null,"appliesTo":"all_records"}'::jsonb),
    ('work_permit_expiry', '{"mode":"conditional","when":{"combine":"all","clauses":[{"operand":"attribute","key":"work_authorization","is":"equals","equals":"work_permit"}]},"requiredFrom":null,"appliesTo":"all_records"}'::jsonb),
    ('work_permit_number', '{"mode":"conditional","when":{"combine":"all","clauses":[{"operand":"attribute","key":"work_authorization","is":"equals","equals":"work_permit"}]},"requiredFrom":null,"appliesTo":"all_records"}'::jsonb),
    ('work_permit_type', '{"mode":"conditional","when":{"combine":"all","clauses":[{"operand":"attribute","key":"work_authorization","is":"equals","equals":"work_permit"}]},"requiredFrom":null,"appliesTo":"all_records"}'::jsonb)
  ) AS r(key, requiredness)
 WHERE d.tenant_id = 'f7cd0fb6-b509-4547-83a9-25b14774a29f'::uuid
   AND d.key = r.key
   AND d.deprecated_at IS NULL;
