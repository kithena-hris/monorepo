import type { Meta, StoryObj } from '@storybook/react-vite';

import { ChartCard } from '../components/chart/chart-card';
import { CohortChart } from '../components/chart/cohort-chart';

const meta = {
  title: 'Charts/Cohort',
  component: CohortChart,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'How each group of joiners stays over time. Read across a row for one cohort, and down a column to compare cohorts at the same age. Built as a real `<table>`, so the accessible version and the visual one are the same thing; the empty triangle is the future, left blank rather than drawn as zero.',
      },
    },
  },
  args: {
    label: 'Retention by joining quarter, months since joining',
    periods: ['M0', 'M3', 'M6', 'M9', 'M12'],
    cohorts: [
      { label: 'Q1 2025', values: [100, 96, 92, 88, 85] },
      { label: 'Q2 2025', values: [100, 97, 93, 90, null] },
      { label: 'Q3 2025', values: [100, 94, 89, null, null] },
      { label: 'Q4 2025', values: [100, 98, null, null, null] },
      { label: 'Q1 2026', values: [100, null, null, null, null] },
    ],
    summary: 'Every cohort keeps at least 85% of its joiners after a year.',
  },
} satisfies Meta<typeof CohortChart>;

export default meta;
type Story = StoryObj<typeof meta>;

export const RetentionByJoiningQuarter: Story = {
  name: 'Retention by joining quarter',
  render: (args) => (
    <ChartCard title="Retention by joining quarter">
      <CohortChart {...args} />
    </ChartCard>
  ),
};
