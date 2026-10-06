import type { Meta, StoryObj } from '@storybook/react-native-web-vite';

import { TEAMS } from '../../docs/charts.ts';
import { designDocs } from '../../docs/design.ts';
import { ChartCard } from './parts.tsx';
import { TreemapChart } from './part-chart.tsx';

const meta = {
  title: 'Charts/Treemap',
  component: TreemapChart,
  parameters: designDocs('treemap'),
} satisfies Meta<typeof TreemapChart>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Monthly cost in cents, printed in thousands of euros. */
const inK = (cents: number): string => `€${String(Math.round(cents / 100_000))}k`;

export const PayrollCostByTeam: Story = {
  name: 'Payroll cost by team',
  args: {
    label: 'Payroll cost by team, per month',
    summary: 'Engineering is €612k of €1,284k a month, nearly half.',
    format: inK,
    data: [
      { label: 'Engineering', value: 612 },
      { label: 'Sales', value: 248 },
      { label: 'Support', value: 156 },
      { label: 'Design', value: 118 },
      { label: 'Finance', value: 84 },
      { label: 'People', value: 66 },
    ].map((team) => ({ ...team, value: team.value * 100_000 })),
  },
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
    summary: 'Engineering is 40% of the company.',
    data: TEAMS,
    highlightIndex: 0,
  },
  render: (args) => (
    <ChartCard title="Headcount by team" description="Engineering is 40% of the company">
      <TreemapChart {...args} />
    </ChartCard>
  ),
};
