import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { useState } from 'react';

import { HIRES, LEAVERS, MONTH_NAMES, TEAMS, byMonth } from '../../docs/charts.ts';
import { designDocs } from '../../docs/design.ts';
import { Stack } from '../layout/layout.tsx';
import { BarChart, HorizontalBarChart, StackedBarChart } from './bar-chart.tsx';
import { ChartCard } from './parts.tsx';

const meta = {
  title: 'Charts/Bar',
  parameters: designDocs('bar'),
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const quarters = ['Q1', 'Q2', 'Q3', 'Q4'];

export const VerticalPeriods: Story = {
  name: 'Vertical: periods',
  render: () => (
    <ChartCard title="Hires, 2026" value="82" description="14 in September, the most so far">
      <BarChart
        label="Hires by month, 2026"
        summary="82 hires in 2026. The most was 14 in September."
        data={byMonth(HIRES)}
        highlightIndex={8}
        futureFrom={9}
      />
    </ChartCard>
  ),
};

export const WithATargetLine: Story = {
  name: 'With a target line',
  render: () => (
    <ChartCard title="Hires per quarter vs target" value="82 / 90">
      <BarChart
        label="Hires per quarter against a target of 25"
        summary="Q1 missed the target of 25; Q2 and Q3 beat it."
        data={quarters.map((q, i) => ({ label: q, value: [22, 30, 30, 0][i] ?? 0 }))}
        reference={{ value: 25, label: 'Target 25' }}
        warnBelowReference
        futureFrom={3}
        maxBarWidth={56}
      />
    </ChartCard>
  ),
};

export const HorizontalCategories: Story = {
  name: 'Horizontal: categories',
  render: () => (
    <ChartCard title="Headcount by team">
      <HorizontalBarChart
        label="Headcount by team"
        summary="Engineering is the largest team, with 124 people."
        data={TEAMS}
      />
    </ChartCard>
  ),
};

export const StackedAndNormalised: Story = {
  name: 'Stacked and normalised',
  render: () => (
    <Stack gap={3}>
      <ChartCard title="Hires by level">
        <StackedBarChart
          label="Hires by level, per quarter"
          categories={quarters}
          series={[
            { label: 'Junior', values: [8, 12, 10, 0] },
            { label: 'Mid', values: [10, 12, 14, 0] },
            { label: 'Senior', values: [4, 6, 6, 0] },
          ]}
          maxBarWidth={56}
        />
      </ChartCard>
      <ChartCard title="Gender by team, normalised">
        <StackedBarChart
          label="Gender by team, as shares of each team"
          orientation="horizontal"
          normalise
          categories={['Engineering', 'Design', 'Sales']}
          series={[
            { label: 'Men', values: [62, 40, 52] },
            { label: 'Women', values: [34, 56, 46] },
            { label: 'Non-binary', values: [4, 4, 2] },
          ]}
          format={(v) => `${String(v)}%`}
        />
      </ChartCard>
    </Stack>
  ),
};

function SelectableBars(): React.JSX.Element {
  const data = byMonth(LEAVERS.slice(0, 9));
  const [selected, setSelected] = useState(8);
  const point = data[selected];
  return (
    <ChartCard
      title="Leavers by month"
      value={String(point?.value ?? 0)}
      description={`${MONTH_NAMES[selected] ?? ''} · tap a bar to filter the table`}
    >
      <BarChart
        label="Leavers by month, January to September"
        data={data}
        selectedIndex={selected}
        onSelect={(_, index) => {
          setSelected(index);
        }}
      />
    </ChartCard>
  );
}

export const Selectable: Story = {
  name: 'Selectable bars',
  render: () => <SelectableBars />,
};
