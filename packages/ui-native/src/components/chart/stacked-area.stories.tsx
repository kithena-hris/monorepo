import type { Meta, StoryObj } from '@storybook/react-native-web-vite';

import { designDocs } from '../../docs/design.ts';
import { StackedAreaChart } from './area-chart.tsx';
import { ChartCard } from './parts.tsx';

const months = ['Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep'];

const meta = {
  title: 'Charts/Stacked area',
  component: StackedAreaChart,
  parameters: designDocs('stacked-area'),
} satisfies Meta<typeof StackedAreaChart>;

export default meta;
type Story = StoryObj<typeof meta>;

export const HeadcountByTeam: Story = {
  name: 'Headcount by team',
  args: {
    label: 'Headcount by team, March to September',
    summary: 'Every team grew; Engineering most, from 100 to 124.',
    categories: months,
    series: [
      { label: 'Engineering', values: [100, 104, 108, 112, 116, 120, 124] },
      { label: 'Sales', values: [52, 54, 56, 58, 60, 62, 64] },
      { label: 'Support', values: [40, 41, 43, 44, 46, 47, 48] },
      { label: 'Other', values: [60, 62, 64, 68, 70, 72, 76] },
    ],
  },
  render: (args) => (
    <ChartCard title="Headcount by team" value="312">
      <StackedAreaChart {...args} />
    </ChartCard>
  ),
};

export const NormalisedTo100: Story = {
  name: 'Normalised to 100%',
  args: {
    label: 'Contract mix, March to September, as shares',
    summary: 'Permanent contracts fell from 80% to 72%; contractors rose to 10%.',
    categories: months,
    normalise: true,
    format: (v) => `${String(v)}%`,
    series: [
      { label: 'Permanent', values: [80, 79, 78, 76, 75, 74, 72] },
      { label: 'Fixed term', values: [14, 15, 15, 16, 17, 17, 18] },
      { label: 'Contractor', values: [6, 6, 7, 8, 8, 9, 10] },
    ],
  },
  render: (args) => (
    <ChartCard title="Contract mix">
      <StackedAreaChart {...args} />
    </ChartCard>
  ),
};
