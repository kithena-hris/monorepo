import type { Meta, StoryObj } from '@storybook/react-vite';

import { ChartCard } from '../components/chart/chart-card';
import { ComboChart } from '../components/chart/combo-chart';
import { yearMonths } from './fixtures';

const hires = [6, 9, 7, 12, 10, 8, 5, 11, 14];
const attrition = [7.9, 7.6, 7.4, 7.1, 6.8, 6.6, 6.4, 6.2, 6.1];

const meta = {
  title: 'Charts/Combo',
  component: ComboChart,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Bars and a line on one chart, when two measures share a time axis but have different units. Both axes are labelled, both start at zero, and the legend says which series reads off which side. Use it sparingly: when the units are the same, two lines on one axis say it more honestly.',
      },
    },
  },
  args: {
    label: 'Hires and attrition, January to September 2026',
    barLabel: 'Hires',
    lineLabel: 'Attrition %',
    summary: 'Hiring rose to 14 in September while attrition fell steadily to 6.1%.',
    data: hires.map((bar, index) => ({
      label: yearMonths[index] ?? '',
      bar,
      line: attrition[index] ?? 0,
    })),
  },
} satisfies Meta<typeof ComboChart>;

export default meta;
type Story = StoryObj<typeof meta>;

export const HiresAndAttrition: Story = {
  name: 'Hires and attrition',
  render: (args) => (
    <ChartCard title="Hires vs attrition, 2026">
      <ComboChart {...args} />
    </ChartCard>
  ),
};

export const BudgetAndSpend: Story = {
  name: 'Budget and spend',
  args: {
    label: 'Monthly spend against budget, €k, January to June 2026',
    barLabel: 'Spend',
    lineLabel: 'Budget',
    summary: 'Spend ran over budget in February and June.',
    formatBar: (value: number) => `€${String(Math.round(value))}k`,
    formatLine: (value: number) => `€${String(Math.round(value))}k`,
    data: [82, 86, 90, 88, 94, 97].map((bar, index) => ({
      label: yearMonths[index] ?? '',
      bar,
      line: [85, 85, 90, 90, 95, 95][index] ?? 0,
    })),
  },
  render: (args) => (
    <ChartCard title="Monthly spend vs budget, €k">
      <ComboChart {...args} />
    </ChartCard>
  ),
};
