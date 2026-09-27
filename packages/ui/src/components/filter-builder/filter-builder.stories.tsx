import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';

import { Badge } from '../badge/badge';
import {
  FilterBuilder,
  isConditionComplete,
  type FilterField,
  type FilterGroup,
} from './filter-builder';

const fields: FilterField[] = [
  {
    id: 'team',
    label: 'Team',
    operators: [
      { id: 'in', label: 'is any of', value: 'options' },
      { id: 'not_in', label: 'is none of', value: 'options' },
      { id: 'unset', label: 'is empty', value: 'none' },
    ],
    options: [
      { value: 'engineering', label: 'Engineering' },
      { value: 'research', label: 'Research' },
      { value: 'people', label: 'People' },
      { value: 'finance', label: 'Finance' },
    ],
  },
  {
    id: 'start',
    label: 'Start date',
    operators: [{ id: 'between', label: 'is between', value: 'date-range' }],
  },
  {
    id: 'title',
    label: 'Job title',
    operators: [
      { id: 'contains', label: 'contains', value: 'text' },
      { id: 'unset', label: 'is empty', value: 'none' },
    ],
  },
  {
    id: 'fte',
    label: 'FTE',
    operators: [
      { id: 'gte', label: 'is at least', value: 'number' },
      { id: 'lte', label: 'is at most', value: 'number' },
    ],
  },
  {
    id: 'status',
    label: 'Status',
    operators: [{ id: 'is', label: 'is', value: 'option' }],
    options: [
      { value: 'active', label: 'Active' },
      { value: 'on_leave', label: 'On leave' },
    ],
  },
  {
    id: 'missing',
    label: 'Record',
    operators: [{ id: 'missing', label: 'has missing information', value: 'none' }],
  },
];

const started: FilterGroup = {
  match: 'all',
  conditions: [
    { id: 'c1', field: 'team', operator: 'in', values: ['engineering', 'research'] },
    { id: 'c2', field: 'start', operator: 'between', values: ['2026-01-01', '2026-03-31'] },
  ],
};

let next = 0;
const newId = (): string => {
  next += 1;
  return `new-${String(next)}`;
};

const meta = {
  title: 'Components/FilterBuilder',
  component: FilterBuilder,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: [
          'Conditions, one per row: a field, an operator, a value. All or any, never a tree: nested groups are where a filter stops being checkable by reading it.',
          '',
          '### Presentational',
          '',
          'The application supplies the fields, the operators it will honour for each, and the options it may offer. The builder evaluates nothing and holds no state, so the application decides whether a change applies at once or waits for an Apply.',
          '',
          '### Values are canonical strings',
          '',
          'A text, a number, an ISO date, an option key, never a rendered label: a relabelled option does not silently break a saved filter. `isConditionComplete` says whether a row has said enough to apply.',
        ].join('\n'),
      },
    },
  },
  args: { fields, value: started, onChange: fn(), newId },
} satisfies Meta<typeof FilterBuilder>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: function Playground(args) {
    const [value, setValue] = useState(args.value);
    const complete = value.conditions.filter((c) => isConditionComplete(fields, c)).length;
    return (
      <div className="flex max-w-3xl flex-col gap-4">
        <FilterBuilder
          {...args}
          value={value}
          onChange={(v) => {
            setValue(v);
            args.onChange(v);
          }}
        />
        <p aria-live="polite" className="text-sm text-fg-muted">
          {complete} of {value.conditions.length} conditions ready to apply
        </p>
      </div>
    );
  },
};

export const Empty: Story = {
  name: 'Nothing yet',
  args: { value: { match: 'all', conditions: [] } },
  render: function EmptyStory(args) {
    const [value, setValue] = useState(args.value);
    return <FilterBuilder {...args} value={value} onChange={setValue} />;
  },
};

export const AnyOf: Story = {
  name: 'Any condition',
  parameters: {
    docs: {
      description: {
        story:
          'With `any`, each row after the first reads "or". The words change with the choice, so the sentence stays true.',
      },
    },
  },
  args: {
    value: {
      match: 'any',
      conditions: [
        { id: 'a1', field: 'missing', operator: 'missing', values: [] },
        { id: 'a2', field: 'title', operator: 'unset', values: [] },
      ],
    },
  },
  render: function AnyStory(args) {
    const [value, setValue] = useState(args.value);
    return <FilterBuilder {...args} value={value} onChange={setValue} />;
  },
};

export const Chips: Story = {
  name: 'Applied, as removable chips',
  parameters: {
    docs: {
      description: {
        story:
          'Once applied, the conditions belong above the results as chips: each one removable on its own, with a named button, and a way to clear them all. `Badge` with `onRemove` is the chip.',
      },
    },
  },
  render: function ChipsStory() {
    const [chips, setChips] = useState(['Team is Engineering or Research', 'Started in Q1 2026']);
    return (
      <ul aria-label="Active filters" className="flex flex-wrap gap-2">
        {chips.map((chip) => (
          <li key={chip}>
            <Badge
              onRemove={() => {
                setChips((all) => all.filter((c) => c !== chip));
              }}
            >
              {chip}
            </Badge>
          </li>
        ))}
      </ul>
    );
  },
};
