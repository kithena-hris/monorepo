import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { View } from 'react-native-css/components';

import { TEAMS } from '../../docs/charts.ts';
import { designDocs } from '../../docs/design.ts';
import { Stack } from '../layout/layout.tsx';
import { Text } from '../text/text.tsx';
import { HorizontalBarChart } from './bar-chart.tsx';
import { DonutChart } from './distribution-chart.tsx';
import { ChartCard } from './parts.tsx';
import { seriesTone } from './tones.ts';

const meta = {
  title: 'Charts/Distribution',
  component: DonutChart,
  parameters: designDocs('distribution'),
  args: {
    label: 'Headcount by team',
    summary: 'Engineering is 40% of the company: 124 of 312 people.',
    data: TEAMS,
    centerLabel: 'people',
  },
} satisfies Meta<typeof DonutChart>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: (args) => (
    <ChartCard title="Headcount by team">
      <DonutChart {...args} />
    </ChartCard>
  ),
};

export const WhenItStopsWorking: Story = {
  name: 'When it stops working',
  render: () => (
    <Stack gap={3}>
      <Stack gap={2}>
        <Text variant="footnote" weight="semibold" tone="muted">
          12 slices: unreadable
        </Text>
        <DonutChart
          label="Twelve locations, as a donut"
          size={130}
          showLegend={false}
          data={Array.from({ length: 12 }, (_, i) => ({
            label: `Location ${String(i + 1)}`,
            value: 20 - i,
            tone: seriesTone(i),
          }))}
        />
      </Stack>
      <Stack gap={2}>
        <Text variant="footnote" weight="semibold" tone="muted">
          Use a bar chart instead
        </Text>
        <HorizontalBarChart
          label="Headcount by location"
          data={[
            { label: 'Berlin', value: 98 },
            { label: 'London', value: 64 },
            { label: 'Paris', value: 38 },
            { label: 'Madrid', value: 30 },
            { label: 'Other', value: 82 },
          ]}
        />
      </Stack>
    </Stack>
  ),
};

const split = [
  { label: 'Permanent', value: 60 },
  { label: 'Fixed term', value: 30 },
  { label: 'Contractor', value: 10 },
];

export const Sizes: Story = {
  render: () => (
    <View className="flex-row flex-wrap items-center gap-5">
      <DonutChart
        label="Contract types, small"
        size={64}
        showLegend={false}
        center="60%"
        data={split}
      />
      <DonutChart
        label="Contract types, medium"
        size={110}
        showLegend={false}
        center="60%"
        data={split}
      />
      <DonutChart
        label="Contract types, large"
        size={160}
        showLegend={false}
        center="60%"
        centerLabel="Permanent"
        data={split}
      />
      <DonutChart
        label="Permanent share, thin"
        size={110}
        thin
        showLegend={false}
        center="72%"
        data={[
          { label: 'Permanent', value: 72 },
          { label: 'Other', value: 28 },
        ]}
      />
    </View>
  ),
};
