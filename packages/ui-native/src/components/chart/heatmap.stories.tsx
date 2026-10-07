import type { Meta, StoryObj } from '@storybook/react-native-web-vite';

import { designDocs, designNote } from '../../docs/design.ts';
import { Stack } from '../layout/layout.tsx';
import { HeatmapChart, type HeatmapCell } from './distribution-chart.tsx';
import { ChartCard } from './parts.tsx';

const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const weeks = ['W1', 'W2', 'W3', 'W4', 'W5'];
const grid = [
  [2, 4, 6, 5, 3, 1, 0],
  [3, 6, 9, 8, 5, 2, 1],
  [4, 7, 10, 9, 6, 2, 0],
  [3, 6, 8, 7, 5, 1, 0],
  [2, 4, 5, 4, 2, 0, 0],
];

function cells(values: readonly (readonly number[])[], rows = weeks): HeatmapCell[] {
  return values.flatMap((row, r) =>
    row.map((value, c) => ({ row: rows[r] ?? '', column: days[c] ?? '', value })),
  );
}

const initial = (day: string): string => day.charAt(0);

const meta = {
  title: 'Charts/Heatmap',
  component: HeatmapChart,
  parameters: designDocs('heatmap'),
  args: {
    label: 'Leave requests by week and day',
    summary: 'Wednesdays in week 3 are the busiest, with 10 requests.',
    rows: weeks,
    columns: days,
    cells: cells(grid),
    columnLabel: initial,
    describe: (value, row, column) => `${row}, ${column}: ${String(value)} requests`,
  },
} satisfies Meta<typeof HeatmapChart>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: (args) => (
    <ChartCard title="Leave requests by week and day">
      <HeatmapChart {...args} />
    </ChartCard>
  ),
};

export const AFixedScale: Story = {
  name: 'A fixed scale',
  parameters: designNote('heatmap', 'A fixed scale'),
  render: () => (
    <Stack gap={3}>
      <ChartCard title="Engineering · max 10">
        <HeatmapChart
          label="Engineering leave requests by week and day, on a scale to 10"
          rows={weeks}
          columns={days}
          cells={cells(grid)}
          columnLabel={initial}
          showRowLabels={false}
          showValues
          max={10}
        />
      </ChartCard>
      <ChartCard title="Sales · same scale">
        <HeatmapChart
          label="Sales leave requests by week and day, on a scale to 10"
          rows={weeks}
          columns={days}
          cells={cells(grid.map((row) => row.map((v) => Math.round(v / 2))))}
          columnLabel={initial}
          showRowLabels={false}
          showValues
          max={10}
        />
      </ChartCard>
    </Stack>
  ),
};

const ramp = [1, 3, 5, 7, 9, 10, 8, 6, 4, 2, 1, 0];
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const Tones: Story = {
  render: () => (
    <Stack gap={2}>
      {(['accent', 'success', 'warning', 'danger'] as const).map((tone) => (
        <HeatmapChart
          key={tone}
          label={`A year of activity, in the ${tone} tone`}
          tone={tone}
          rows={['2026']}
          columns={months}
          cells={ramp.map((value, i) => ({ row: '2026', column: months[i] ?? '', value }))}
          columnLabel={() => ''}
          showRowLabels={false}
          showScale={false}
          cellRatio={1.4}
        />
      ))}
    </Stack>
  ),
};
