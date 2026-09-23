import type { PersonFields } from '../person-repository.js';

/**
 * Attribute keys that live in a typed column rather than in `custom`.
 *
 * The registry names them like any other attribute; storage gives them a real
 * type and a real constraint because every screen sorts and joins on them.
 * Anything not listed here is `custom`.
 *
 * ponytail: `base_salary`/`fte` are not mapped. Money in a column needs the
 * currency's exponent to move between minor units and `numeric(19,4)`; until
 * a ticket needs the column, a money attribute is stored like any other value
 * (and sealed, when it is financial).
 */
export const CORE_COLUMNS = {
  given_name: 'givenName',
  family_name: 'familyName',
  preferred_name: 'preferredName',
  work_email: 'workEmail',
  employee_number: 'employeeNumber',
  seniority_date: 'seniorityDate',
  legal_entity_id: 'legalEntityId',
  manager_id: 'managerId',
  org_unit_id: 'orgUnitId',
  location_id: 'locationId',
  employment_type: 'employmentType',
  work_model: 'workModel',
} as const satisfies Record<string, keyof PersonFields>;

export type CoreKey = keyof typeof CORE_COLUMNS;

export function isCoreKey(key: string): key is CoreKey {
  return Object.hasOwn(CORE_COLUMNS, key);
}

/**
 * Keys the lifecycle owns. Readable like any attribute, never written by a
 * profile update: a hire date moves through `hire()`, not through a PATCH.
 */
export const LIFECYCLE_KEYS: ReadonlySet<string> = new Set(['hire_date', 'last_working_day']);
