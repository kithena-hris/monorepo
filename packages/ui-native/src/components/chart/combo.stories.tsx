import type { Meta, StoryObj } from '@storybook/react-native-web-vite';

import { MONTH_NAMES } from '../../docs/charts.ts';
import { designDocs } from '../../docs/design.ts';
import { ComboChart } from './area-chart.tsx';
import { ChartCard } from './parts.tsx';

const meta = {
  title: 'Charts/Combo',
  component: ComboChart,
  parameters: designDocs('combo'),
} satisfies Meta<typeof ComboChart>;

export default meta;
type Story = StoryObj<typeof meta>;

const month = (i: number) => ({
  label: MONTH_NAMES[i] ?? '',
  axisLabel: (MONTH_NAMES[i] ?? '').charAt(0),
});

export const HiresAndAttrition: Story = {
  name: 'Hires and attrition',
  args: {
    label: 'Hires and attrition by month, 2026',
    summary: 'Hiring peaked at 14 in September while attrition fell from 7.9% to 6.1%.',
    barLabel: 'Hires (left)',
    lineLabel: 'Attrition % (right)',
    formatLine: (v) => `${v.toFixed(1)}%`,
    data: [6, 9, 7, 12, 10, 8, 5, 11, 14].map((bar, i) => ({
      ...month(i),
      bar,
      line: [7.9, 7.6, 7.4, 7.1, 6.8, 6.6, 6.4, 6.2, 6.1][i] ?? 0,
    })),
  },
  render: (args) => (
    <ChartCard title="Hires vs attrition, 2026">
      <ComboChart {...args} />
    </ChartCard>
  ),
};

/** Minor units in, thousands of euros out. */
const inK = (cents: number): string => `€${String(Math.round(cents / 100_000))}k`;

export const BudgetAndSpend: Story = {
  name: 'Budget and spend',
  args: {
    label: 'Monthly spend against budget, January to June',
    summary: 'Spend ran over budget in February and June.',
    barLabel: 'Spend',
    lineLabel: 'Budget',
    formatBar: inK,
    formatLine: inK,
    data: [82, 86, 90, 88, 94, 97].map((spend, i) => ({
      ...month(i),
      bar: spend * 100_000,
      line: ([85, 85, 90, 90, 95, 95][i] ?? 0) * 100_000,
    })),
  },
  render: (args) => (
    <ChartCard title="Monthly spend vs budget, €k">
      <ComboChart {...args} />
    </ChartCard>
  ),
};
