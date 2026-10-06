import type { Meta, StoryObj } from '@storybook/react-native-web-vite';

import { designDocs } from '../../docs/design.ts';
import { HistogramChart } from './part-chart.tsx';
import { ChartCard } from './parts.tsx';

const meta = {
  title: 'Charts/Histogram',
  component: HistogramChart,
  parameters: designDocs('histogram'),
} satisfies Meta<typeof HistogramChart>;

export default meta;
type Story = StoryObj<typeof meta>;

/** `count` figures spread through a bin, so the chart counts them itself. */
function spread(counts: readonly number[], from: number, step: number): number[] {
  return counts.flatMap((count, i) =>
    Array.from({ length: count }, (_, j) => from + i * step + ((j + 0.5) / count) * step),
  );
}

export const Tenure: Story = {
  args: {
    label: 'Tenure in years, 312 people',
    summary: 'Median tenure is 2.4 years; 82 people joined less than a year ago.',
    values: spread([82, 64, 58, 41, 28, 19, 20], 0, 1),
    step: 1,
    start: 1,
    end: 6,
    highlightIndex: 2,
  },
  render: (args) => (
    <ChartCard title="Tenure, years" description="Median 2.4 years">
      <HistogramChart {...args} />
    </ChartCard>
  ),
};

export const SalarySpread: Story = {
  name: 'Salary spread',
  args: {
    label: 'Salaries in thousands of euros',
    summary: 'Most salaries fall between €60k and €90k.',
    // Salaries in cents, as money always is; the bins print thousands of euros.
    values: spread([6, 22, 48, 64, 58, 44, 30, 20, 12, 8], 4_000_000, 1_000_000),
    step: 1_000_000,
    start: 4_000_000,
    end: 13_000_000,
    formatBin: (bin) =>
      Number.isFinite(bin.to)
        ? String(Math.round(bin.from / 100_000))
        : `${String(Math.round(bin.from / 100_000))}+`,
  },
  render: (args) => (
    <ChartCard title="Salaries, €k">
      <HistogramChart {...args} />
    </ChartCard>
  ),
};
