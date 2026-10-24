import type { FilterField, FilterGroup } from './filter-builder.tsx';
import { t as tr } from '../../lib/i18n';

/** The people directory's filterable fields, for stories. */
export const PEOPLE_FIELDS: FilterField[] = [
  {
    id: 'team',
    get label(): string {
      return tr('components.filter-builder.fields.team', 'Team');
    },
    operators: [
      {
        id: 'is',
        get label(): string {
          return tr('components.filter-builder.fields.is', 'is');
        },
        value: 'option',
      },
      {
        id: 'is-not',
        get label(): string {
          return tr('components.filter-builder.fields.is_not', 'is not');
        },
        value: 'option',
      },
    ],
    options: ['Engineering', 'Design', 'Sales', 'Support', 'Finance', 'People'].map((t) => ({
      value: t,
      label: t,
    })),
  },
  {
    id: 'location',
    get label(): string {
      return tr('components.filter-builder.fields.location', 'Location');
    },
    operators: [
      {
        id: 'is',
        get label(): string {
          return tr('components.filter-builder.fields.is', 'is');
        },
        value: 'option',
      },
      {
        id: 'is-not',
        get label(): string {
          return tr('components.filter-builder.fields.is_not', 'is not');
        },
        value: 'option',
      },
    ],
    options: ['Berlin', 'London', 'Remote', 'Tokyo', 'Paris'].map((l) => ({ value: l, label: l })),
  },
  {
    id: 'start',
    get label(): string {
      return tr('components.filter-builder.fields.start_date', 'Start date');
    },
    operators: [
      {
        id: 'after',
        get label(): string {
          return tr('components.filter-builder.fields.is_after', 'is after');
        },
        value: 'date',
      },
      {
        id: 'before',
        get label(): string {
          return tr('components.filter-builder.fields.is_before', 'is before');
        },
        value: 'date',
      },
    ],
  },
  {
    id: 'salary',
    get label(): string {
      return tr('components.filter-builder.fields.salary', 'Salary');
    },
    operators: [
      {
        id: 'above',
        get label(): string {
          return tr('components.filter-builder.fields.is_above', 'is above');
        },
        value: 'number',
      },
      {
        id: 'below',
        get label(): string {
          return tr('components.filter-builder.fields.is_below', 'is below');
        },
        value: 'number',
      },
    ],
  },
  {
    id: 'contract',
    get label(): string {
      return tr('components.filter-builder.fields.contract', 'Contract');
    },
    operators: [
      {
        id: 'is',
        get label(): string {
          return tr('components.filter-builder.fields.is', 'is');
        },
        value: 'option',
      },
    ],
    options: ['Permanent', 'Fixed term', 'Contractor'].map((c) => ({ value: c, label: c })),
  },
];

export const TWO_CONDITIONS: FilterGroup = {
  match: 'all',
  conditions: [
    { id: 'c1', field: 'team', operator: 'is', values: ['Engineering'] },
    { id: 'c2', field: 'start', operator: 'after', values: ['2024-01-01'] },
  ],
};
