import type { Meta, StoryObj } from '@storybook/react-vite';

import { ChartCard } from '../components/chart/chart-card';
import { StackedAreaChart } from '../components/chart/stacked-area-chart';

const months = ['Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep'];

const meta = {
  title: 'Charts/Stacked area',
  component: StackedAreaChart,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'How a total changes over time, and what makes it up. Keep it to five layers or fewer, with the biggest at the bottom: only the bottom layer sits on a flat baseline, so it is the only one whose changes can be read directly. Hover or tab across the plot for every layer at a period.',
      },
    },
  },
  args: {
    label: 'Headcount by team, March to September 2026',
    categories: months,
    series: [
      { label: 'Engineering', values: [100, 104, 108, 112, 116, 120, 124] },
      { label: 'Sales', values: [52, 54, 56, 58, 60, 62, 64] },
      { label: 'Support', values: [40, 41, 43, 44, 46, 47, 48] },
      { label: 'Other', values: [60, 62, 64, 68, 70, 72, 76] },
    ],
    summary:
      'Headcount grew from 252 to 312, with Engineering the largest and fastest-growing team.',
  },
} satisfies Meta<typeof StackedAreaChart>;

export default meta;
type Story = StoryObj<typeof meta>;

export const HeadcountByTeam: Story = {
  name: 'Headcount by team',
  render: (args) => (
    <ChartCard title="Headcount by team" value="312">
      <StackedAreaChart {...args} />
    </ChartCard>
  ),
};

export const Normalised: Story = {
  name: 'Normalised to 100%',
  args: {
    label: 'Contract mix, March to September 2026',
    normalise: true,
    series: [
      { label: 'Permanent', values: [80, 79, 78, 76, 75, 74, 72] },
      { label: 'Fixed term', values: [14, 15, 15, 16, 17, 17, 18] },
      { label: 'Contractor', values: [6, 6, 7, 8, 8, 9, 10] },
    ],
    summary: 'The permanent share fell from 80% to 72% as contractors grew.',
  },
  parameters: {
    docs: {
      description: {
        story:
          'Every period fills the height, so the chart answers "what share" and stops answering "how many". The tooltip carries both.',
      },
    },
  },
  render: (args) => (
    <ChartCard title="Contract mix">
      <StackedAreaChart {...args} />
    </ChartCard>
  ),
};
