-- A company whose people were imported with a `department` field, a select
-- the company defined, and no departments of its own: every module groups
-- people by People's departments (`people.org_unit`), so for those companies
-- they had none to offer, and no department filter worked.
--
-- For each such company, once: a department per value in use, named by the
-- option's label where the field is a select, else the value as typed, and
-- each person placed in theirs. The field itself is left for People to
-- retire (`department-field.ts`), once these exist. The
-- company is then due its snapshot, so every module hears of the departments
-- and who is in them after the deploy, as `20261017190000` arranged.
--
-- A company that already has departments is not touched: its own structure
-- wins over a field.
DO $$
BEGIN
  CREATE TEMP TABLE department_from_field ON COMMIT DROP AS
  SELECT used.tenant_id,
         used.value,
         left(btrim(COALESCE(
           (SELECT o -> 'label' ->> 'default'
              FROM people.attribute_definition d,
                   jsonb_array_elements(d.type_config -> 'options') o
             WHERE d.tenant_id = used.tenant_id
               AND d.key = 'department'
               AND d.type_config ->> 'kind' = 'select'
               AND o ->> 'value' = used.value
             LIMIT 1),
           -- A key, `field_sales`, reads as words; anything else is kept as typed.
           CASE WHEN used.value ~ '^[a-z0-9_]+$' THEN initcap(replace(used.value, '_', ' '))
                ELSE used.value END)), 200) AS name
    FROM (SELECT DISTINCT p.tenant_id, p.custom ->> 'department' AS value
            FROM people.person p
           WHERE jsonb_typeof(p.custom -> 'department') = 'string'
             AND btrim(p.custom ->> 'department') <> ''
             AND NOT EXISTS (SELECT FROM people.org_unit u WHERE u.tenant_id = p.tenant_id)) used;

  -- One company's field had "HR" for one person beside "People" for the
  -- rest: one department, People, as the company asked (18 Oct 2026).
  UPDATE department_from_field SET name = 'People'
   WHERE tenant_id = 'f7cd0fb6-b509-4547-83a9-25b14774a29f' AND name = 'HR';

  -- Two values with the same label are one department.
  INSERT INTO people.org_unit (tenant_id, id, name)
  SELECT DISTINCT ON (tenant_id, lower(name)) tenant_id, gen_random_uuid(), name
    FROM department_from_field
   WHERE name <> ''
   ORDER BY tenant_id, lower(name), name;

  UPDATE people.person p
     SET org_unit_id = u.id
    FROM department_from_field m
    JOIN people.org_unit u
      ON u.tenant_id = m.tenant_id
     AND lower(u.name) = lower(m.name)
     AND u.parent_id IS NULL
     AND u.archived_at IS NULL
   WHERE p.tenant_id = m.tenant_id
     AND p.custom ->> 'department' = m.value
     AND p.org_unit_id IS NULL;

  INSERT INTO people.snapshot_due (tenant_id, due_at)
  SELECT DISTINCT tenant_id, now() + interval '15 minutes' FROM department_from_field
  ON CONFLICT (tenant_id) DO UPDATE SET due_at = EXCLUDED.due_at;
END $$;
