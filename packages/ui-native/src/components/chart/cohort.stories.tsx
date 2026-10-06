import type { Meta, StoryObj } from '@storybook/react-native-web-vite';

import { designDocs } from '../../docs/design.ts';
import { CohortChart } from './part-chart.tsx';
import { ChartCard } from './parts.tsx';

const meta = {
  title: 'Charts/Cohort',
  component: CohortChart,
  parameters: designDocs('cohort'),
} satisfies Meta<typeof CohortChart>;

export default meta;
type Story = StoryObj<typeof meta>;

export const RetentionByJoiningQuarter: Story = {
  name: 'Retention by joining quarter',
  args: {
    label: 'Retention by joining quarter, every three months',
    summary:
      'The Q1 2025 joiners kept 85% after a year; Q3 2025 is falling fastest, 89% at six months.',
    periods: ['M0', 'M3', 'M6', 'M9', 'M12'],
    cohorts: [
      { label: 'Q1 2025', values: [100, 96, 92, 88, 85] },
      { label: 'Q2 2025', values: [100, 97, 93, 90, null] },
      { label: 'Q3 2025', values: [100, 94, 89, null, null] },
      { label: 'Q4 2025', values: [100, 98, null, null, null] },
      { label: 'Q1 2026', values: [100, null, null, null, null] },
    ],
  },
  render: (args) => (
    <ChartCard title="Retention by joining quarter">
      <CohortChart {...args} />
    </ChartCard>
  ),
};
