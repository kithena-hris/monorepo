import type { Meta, StoryObj } from '@storybook/react-vite';

import { ChartCard } from '../components/chart/chart-card';
import { HistogramChart } from '../components/chart/histogram-chart';

/**
 * A fixed spread of values with a known shape, built from counts rather than
 * from randomness so the chart is the same on every load.
 */
function spread(counts: readonly [number, number][]): number[] {
  return counts.flatMap(([value, count]) => Array.from({ length: count }, () => value));
}

const tenure = spread([
  [0.4, 82],
  [1.5, 64],
  [2.4, 58],
  [3.2, 41],
  [4.6, 28],
  [5.1, 19],
  [7, 20],
]);

const salaries = spread([
  [44, 6],
  [55, 22],
  [63, 48],
  [74, 64],
  [81, 58],
  [96, 44],
  [102, 30],
  [115, 20],
  [124, 12],
  [140, 8],
]);

const meta = {
  title: 'Charts/Histogram',
  component: HistogramChart,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'How values are spread, such as salaries or tenure. The bars touch because the ranges are continuous. Pass the raw values and a `step`: binning happens in the chart, into half-open bins, so a value on an edge is counted once. `start` and `end` add open bins at either end, "under 1 year" and "130k and over".',
      },
    },
  },
  args: {
    label: 'Tenure, years',
    values: tenure,
    step: 1,
    start: 1,
    end: 6,
    highlightIndex: 2,
    summary: 'Most people have been here under two years. The median is 2.4 years.',
  },
} satisfies Meta<typeof HistogramChart>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Tenure: Story = {
  render: (args) => (
    <ChartCard title="Tenure, years" description="Median 2.4 years">
      <HistogramChart {...args} />
    </ChartCard>
  ),
};

export const SalarySpread: Story = {
  name: 'Salary spread',
  args: {
    label: 'Salaries, €k',
    values: salaries,
    step: 10,
    start: 40,
    end: 130,
    summary: 'Most salaries sit between €60k and €90k.',
  },
  render: ({ highlightIndex: _unused, ...args }) => (
    <ChartCard title="Salaries, €k">
      <HistogramChart {...args} />
    </ChartCard>
  ),
};
