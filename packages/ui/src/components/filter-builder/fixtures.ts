import type { FilterField } from './filter-model';

/** Sample fields shared by the FilterBuilder and Complex filters stories. */
export const peopleFields: FilterField[] = [
  {
    id: 'team',
    label: 'Team',
    operators: [
      { id: 'is', label: 'is', value: 'option' },
      { id: 'is-not', label: 'is not', value: 'option' },
      { id: 'in', label: 'is any of', value: 'options' },
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
      { id: 'is', label: 'is', value: 'option' },
      { id: 'is-not', label: 'is not', value: 'option' },
      { id: 'in', label: 'is any of', value: 'options' },
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
    operators: [{ id: 'is', label: 'is', value: 'option' }],
    options: [
      { value: 'permanent', label: 'Permanent' },
      { value: 'fixed-term', label: 'Fixed term' },
    ],
  },
  {
    id: 'start',
    label: 'Start date',
    operators: [
      { id: 'after', label: 'is after', value: 'date' },
      { id: 'before', label: 'is before', value: 'date' },
      { id: 'between', label: 'is between', value: 'date-range' },
    ],
  },
  {
    id: 'phone',
    label: 'Phone',
    operators: [
      { id: 'contains', label: 'contains', value: 'text' },
      { id: 'empty', label: 'is empty', value: 'none' },
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
];
