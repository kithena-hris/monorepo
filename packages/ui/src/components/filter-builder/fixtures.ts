import type { FilterField } from './filter-model';

/** Sample fields shared by the FilterBuilder and Complex filters stories. */
export const peopleFields: FilterField[] = [
  {
    id: 'team',
    label: 'Team',
    operators: [
      { id: 'is', label: 'is' },
      { id: 'is-not', label: 'is not' },
    ],
    options: [
      { value: 'engineering', label: 'Engineering' },
      { value: 'design', label: 'Design' },
      { value: 'sales', label: 'Sales' },
      { value: 'support', label: 'Support' },
    ],
  },
  {
    id: 'location',
    label: 'Location',
    operators: [
      { id: 'is', label: 'is' },
      { id: 'is-not', label: 'is not' },
    ],
    options: [
      { value: 'berlin', label: 'Berlin' },
      { value: 'london', label: 'London' },
      { value: 'remote', label: 'Remote' },
      { value: 'tokyo', label: 'Tokyo' },
    ],
  },
  {
    id: 'contract',
    label: 'Contract',
    operators: [{ id: 'is', label: 'is' }],
    options: [
      { value: 'permanent', label: 'Permanent' },
      { value: 'fixed-term', label: 'Fixed term' },
    ],
  },
  {
    id: 'start',
    label: 'Start date',
    operators: [
      { id: 'after', label: 'is after' },
      { id: 'before', label: 'is before' },
    ],
    inputType: 'date',
  },
  {
    id: 'salary',
    label: 'Salary',
    operators: [
      { id: 'above', label: 'is above' },
      { id: 'below', label: 'is below' },
    ],
    inputType: 'number',
  },
];
