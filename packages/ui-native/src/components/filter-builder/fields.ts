import type { FilterField, FilterGroup } from './filter-builder.tsx';

/** The people directory's filterable fields, for stories. */
export const PEOPLE_FIELDS: FilterField[] = [
  {
    id: 'team',
    label: 'Team',
    operators: [
      { id: 'is', label: 'is', value: 'option' },
      { id: 'is-not', label: 'is not', value: 'option' },
    ],
    options: ['Engineering', 'Design', 'Sales', 'Support', 'Finance', 'People'].map((t) => ({
      value: t,
      label: t,
    })),
  },
  {
    id: 'location',
    label: 'Location',
    operators: [
      { id: 'is', label: 'is', value: 'option' },
      { id: 'is-not', label: 'is not', value: 'option' },
    ],
    options: ['Berlin', 'London', 'Remote', 'Tokyo', 'Paris'].map((l) => ({ value: l, label: l })),
  },
  {
    id: 'start',
    label: 'Start date',
    operators: [
      { id: 'after', label: 'is after', value: 'date' },
      { id: 'before', label: 'is before', value: 'date' },
    ],
  },
  {
    id: 'salary',
    label: 'Salary',
    operators: [
      { id: 'above', label: 'is above', value: 'number' },
      { id: 'below', label: 'is below', value: 'number' },
    ],
  },
  {
    id: 'contract',
    label: 'Contract',
    operators: [{ id: 'is', label: 'is', value: 'option' }],
    options: ['Permanent', 'Fixed term', 'Contractor'].map((c) => ({ value: c, label: c })),
  },
];

export const TWO_CONDITIONS: FilterGroup = {
  match: 'all',
  conditions: [
    { id: 'c1', field: 'team', operator: 'is', values: ['Engineering'] },
    { id: 'c2', field: 'start', operator: 'after', values: ['1 Jan 2024'] },
  ],
};
