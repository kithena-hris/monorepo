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
});

export const TIMEOFF_CATALOGUE = RuntimeCatalogue.parse({
  module: 'timeoff',
  serves: [
    { name: 'timeoff.away', version: 1 },
    { name: 'timeoff.managers', version: 1 },
  ],
  fields: {
    'timeoff.away': [
      select('leave_type', 'Leave type', [
        ['vacation', 'Vacation'],
        ['personal', 'Personal'],
        ['comp', 'Comp'],
        ['sick', 'Baja médica'],
        ['parental', 'Parental leave'],
      ]),
      select('team', 'Team', [
        ['engineering', 'Engineering'],
        ['sales', 'Sales'],
      ]),
    ],
  },
  leaveTypes: [
    { key: 'vacation', name: 'Vacation', private: false },
    { key: 'personal', name: 'Personal', private: false },
    { key: 'comp', name: 'Comp', private: false },
    { key: 'sick', name: 'Baja médica', private: true, category: 'sick_leave' },
    { key: 'parental', name: 'Parental leave', private: true, category: 'parental_leave' },
  ],
});
