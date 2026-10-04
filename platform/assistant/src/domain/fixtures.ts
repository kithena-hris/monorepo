import { RuntimeCatalogue } from '@kithena/contracts';

/**
 * The company every worked example in assistant PRD §7 is set in, as its
 * modules describe it to one asker. Configuration only, as a catalogue is:
 * shared by the domain's tests and, later, the eval set.
 */

const select = (key: string, label: string, options: readonly [string, string][]) => ({
  key,
  label,
  kind: 'select' as const,
  options: options.map(([value, optionLabel]) => ({ value, label: optionLabel })),
});

export const PEOPLE_CATALOGUE = RuntimeCatalogue.parse({
  module: 'people',
  serves: [
    { name: 'people.find', version: 1 },
    { name: 'people.person', version: 1 },
    { name: 'people.reports', version: 1 },
    { name: 'people.managers', version: 1 },
    { name: 'people.approvals', version: 1 },
  ],
  fields: {
    'people.find': [
      select('department', 'Department', [
        ['engineering', 'Engineering'],
        ['sales', 'Sales'],
      ]),
      select('location_id', 'Location', [
        ['madrid', 'Madrid'],
        ['lisbon', 'Lisbon'],
      ]),
      { key: 'hire_date', label: 'Start date', kind: 'date', options: [] },
      { key: 'job_title', label: 'Job title', kind: 'text', options: [] },
    ],
  },
  metrics: [{ key: 'tenure', label: 'Time at the company' }],
  // People's core fields not for AI, and a company's own salary field.
  denied: [
    { key: 'legal_first_name', labels: ['Legal first name'] },
    { key: 'preferred_name', labels: ['Preferred name'] },
    { key: 'work_email', labels: ['Work email'] },
    { key: 'employee_number', labels: ['Employee number'] },
    { key: 'salary', labels: ['Salary', 'Salario'] },
  ],
});

const LEAVE_TYPE = select('leave_type', 'Leave type', [
  ['vacation', 'Vacation'],
  ['personal', 'Personal'],
  ['comp', 'Comp'],
  ['sick', 'Baja médica'],
  ['parental', 'Parental leave'],
]);
const TEAM = select('team', 'Team', [
  ['engineering', 'Engineering'],
  ['sales', 'Sales'],
]);

export const TIMEOFF_CATALOGUE = RuntimeCatalogue.parse({
  module: 'timeoff',
  serves: [
    { name: 'timeoff.away', version: 1 },
    { name: 'timeoff.managers', version: 1 },
    { name: 'timeoff.balances', version: 1 },
  ],
  fields: {
    'timeoff.away': [LEAVE_TYPE, TEAM],
    'timeoff.balances': [
      LEAVE_TYPE,
      { key: 'days_left', label: 'Days left', kind: 'number', options: [] },
      TEAM,
    ],
  },
  leaveTypes: [
    { key: 'vacation', name: 'Vacation', private: false },
    { key: 'personal', name: 'Personal', private: false },
    { key: 'comp', name: 'Comp', private: false },
    { key: 'sick', name: 'Baja médica', private: true, category: 'sick_leave' },
    { key: 'parental', name: 'Parental leave', private: true, category: 'parental_leave' },
  ],
  // Time Off's fixed list (`services/timeoff/src/application/assist/denied.ts`).
  denied: [
    { key: 'sick_note', labels: ['sick note', 'medical note', 'sick leave', 'diagnosis'] },
    { key: 'medical_note', labels: ['medical certificate'] },
    { key: 'due_date', labels: ['due date'] },
    { key: 'birth_date', labels: ['birth date', 'date of birth'] },
    { key: 'display_name', labels: ['display name', 'full name'] },
    { key: 'person_id', labels: ['person id'] },
  ],
});
