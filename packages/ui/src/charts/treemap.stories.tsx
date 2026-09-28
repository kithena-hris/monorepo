import type { Meta, StoryObj } from '@storybook/react-vite';

import { ChartCard } from '../components/chart/chart-card';
import { TreemapChart } from '../components/chart/treemap-chart';
import { teamHeadcount } from './fixtures';

const meta = {
  title: 'Charts/Treemap',
  component: TreemapChart,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Parts of a whole when there are too many parts for a donut. The size of each area is its value, laid out with the squarified algorithm so the cells stay close to square: a square is the only rectangle whose area the eye can compare with another.',
      },
    },
  },
  args: {
    label: 'Payroll cost by team, €k per month',
    data: [
      { label: 'Engineering', value: 612 },
      { label: 'Sales', value: 248 },
      { label: 'Support', value: 156 },
      { label: 'Design', value: 118 },
      { label: 'Finance', value: 84 },
      { label: 'People', value: 66 },
    ],
    format: (value: number) => `€${String(value)}k`,
    summary: 'Engineering is nearly half of payroll, at €612k of €1,284k a month.',
  },
} satisfies Meta<typeof TreemapChart>;

export default meta;
type Story = StoryObj<typeof meta>;

export const PayrollCostByTeam: Story = {
  name: 'Payroll cost by team',
  render: (args) => (
    <ChartCard title="Payroll cost by team, €k/month" value="€1,284k">
      <TreemapChart {...args} />
    </ChartCard>
  ),
};

export const HighlightingOnePart: Story = {
  name: 'Highlighting one part',
  args: {
    label: 'Headcount by team',
    data: teamHeadcount,
    format: (value: number) => String(value),
    highlightIndex: 0,
    summary: 'Engineering is 40% of the company.',
  },
  render: (args) => (
    <ChartCard title="Headcount by team" description="Engineering is 40% of the company">
      <TreemapChart {...args} />
    </ChartCard>
  ),
};
