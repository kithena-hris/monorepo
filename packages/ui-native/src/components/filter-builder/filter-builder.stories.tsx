import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { useState } from 'react';
import { View } from 'react-native-css/components';

import { designDocs } from '../../docs/design.ts';
import { Note } from '../../docs/notes.tsx';
import { PEOPLE_FIELDS, TWO_CONDITIONS } from './fields.ts';
import {
  AppliedFilters,
  FilterBuilder,
  type FilterBuilderProps,
  type FilterGroup,
} from './filter-builder.tsx';

const meta = {
  title: 'Components/FilterBuilder',
  component: FilterBuilder,
  parameters: designDocs('filter-builder'),
  args: { fields: PEOPLE_FIELDS, value: TWO_CONDITIONS, onChange: () => undefined },
} satisfies Meta<typeof FilterBuilder>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The builder owning its filter, as a screen would. */
function Live(props: Omit<FilterBuilderProps, 'value' | 'onChange'> & { start: FilterGroup }) {
  const { start, ...rest } = props;
  const [value, setValue] = useState(start);
  return <FilterBuilder {...rest} value={value} onChange={setValue} />;
}

export const Playground: Story = {
  render: () => <Live fields={PEOPLE_FIELDS} start={TWO_CONDITIONS} applyLabel="Show 48 people" />,
};

export const NothingYet: Story = {
  name: 'Nothing yet',
  render: () => (
    <Live
      fields={PEOPLE_FIELDS}
      start={{ match: 'all', conditions: [] }}
      emptyDescription="Add a condition to narrow down 312 people."
    />
  ),
};

export const AnyCondition: Story = {
  name: 'Any condition',
  render: () => (
    <Live
      fields={PEOPLE_FIELDS}
      matchControl
      applyLabel="Show 96 people"
      errors={{ c3: 'Enter an amount.' }}
      start={{
        match: 'any',
        conditions: [
          { id: 'c1', field: 'location', operator: 'is', values: ['Berlin'] },
          { id: 'c2', field: 'location', operator: 'is', values: ['Remote'] },
          { id: 'c3', field: 'salary', operator: 'above', values: [] },
        ],
      }}
    />
  ),
};

const APPLIED = [
  { id: 'team', field: 'Team', label: 'Engineering' },
  { id: 'start', field: 'Start', label: 'after 1 Jan 2024' },
  { id: 'location', field: 'Location', label: 'Berlin or Remote' },
];

export const AppliedAsChips: Story = {
  name: 'Applied, as removable chips',
  render: function AppliedStory() {
    const [applied, setApplied] = useState(APPLIED);
    return (
      <View className="gap-2.5">
        <AppliedFilters
          filters={applied}
          onRemove={(id) => {
            setApplied(applied.filter((f) => f.id !== id));
          }}
          onClearAll={() => {
            setApplied([]);
          }}
        />
        <Note>{applied.length === 0 ? '312 people' : '48 people match'}</Note>
      </View>
    );
  },
};
