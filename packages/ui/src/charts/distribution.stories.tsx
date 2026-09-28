import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';

import { DonutChart, HorizontalBarChart } from '../components/chart/chart';
import { ChartCard } from '../components/chart/chart-card';
import { AutoGrid } from '../components/layout/layout';
import { byStatus, teamHeadcount } from './fixtures';

const meta = {
  title: 'Charts/Distribution',
  component: DonutChart,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: [
          'Composition of a whole: a headcount split, a leave-type mix.',
          '',
          '### Six slices, biggest first, and the cap is the design',
          '',
          'People compare angles badly, an arc with half the count reads as about a third, and the error grows with the number of segments. A donut with eleven slices is a legend with a decoration attached, and the honest version of that chart is a horizontal bar chart. The last story shows both, on the same data, so the difference is arguable rather than asserted.',
          '',
          '### The legend prints the number',
          '',
          'Both the absolute value and the percentage. A percentage of an unstated total is not a fact, and an angle is not a number.',
          '',
          '### Drawn with `stroke-dasharray`',
          '',
          'Not a conic gradient: the cap stays round. The track shows through underneath, and a 1px gap between segments keeps two adjacent slices of similar lightness from merging into one shape.',
          '',
          '### The hole is for the total',
          '',
          'The hole shows the number the slices sum to unless `center` says otherwise, with `centerLabel` for the word under it. It is the fact a donut otherwise throws away, and putting anything else there, a seventh slice, an icon, wastes the one piece of screen the reader is looking at.',
        ].join('\n'),
      },
    },
  },
  argTypes: {
    data: {
      description:
        'Up to six slices, biggest first. Each carries its own `tone` or takes the palette in order.',
      control: 'object',
      table: { type: { summary: 'readonly DonutSlice[]' }, category: 'Data' },
    },
    label: { control: 'text', table: { type: { summary: 'string' }, category: 'Data' } },
    size: {
      description: 'Diameter in pixels. The stroke scales with it.',
      control: { type: 'range', min: 80, max: 260, step: 10 },
      table: {
        type: { summary: 'number' },
        defaultValue: { summary: '170' },
        category: 'Appearance',
      },
    },
    center: {
      description: 'Rendered in the hole. The total, not a sixth slice.',
      control: false,
      table: { type: { summary: 'ReactNode' }, category: 'Content' },
    },
    format: {
      control: false,
      table: { type: { summary: '(value: number) => string' }, category: 'Data' },
    },
    className: {
      control: 'text',
      table: { type: { summary: 'string' }, category: 'Escape hatches' },
    },
  },
  args: {
    label: 'Employees by status',
    data: byStatus,
    size: 170,
    // Spies, so the **Actions** panel shows what the callback is handed and
    // when, the fastest answer to the question people actually have about a
    // chart's API.
    onSelect: fn(),
  },
} satisfies Meta<typeof DonutChart>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  args: {
    label: 'Headcount by team',
    data: teamHeadcount,
    centerLabel: 'people',
  },
  render: (args) => (
    <ChartCard title="Headcount by team" className="max-w-xl">
      <DonutChart {...args} />
    </ChartCard>
  ),
};

export const TooManySlices: Story = {
  name: 'When it stops working',
  parameters: {
    docs: {
      description: {
        story:
          'Twelve slices is unreadable: try to say which of two neighbours is larger without the legend. The same kind of data as bars says it at a glance. That is the whole case for the cap of six.',
      },
    },
  },
  render: () => (
    <AutoGrid minItemWidth="18rem" gap={3}>
      <ChartCard title="12 slices: unreadable">
        <DonutChart
          label="Twelve locations, as a donut"
          size={130}
          showLegend={false}
          data={Array.from({ length: 12 }, (_, index) => ({
            label: `Location ${String(index + 1)}`,
            value: 20 - index,
          }))}
        />
      </ChartCard>
      <ChartCard title="Use a bar chart instead">
        <HorizontalBarChart
          label="Headcount by office"
          data={[
            { label: 'Berlin', value: 98 },
            { label: 'London', value: 64 },
            { label: 'Paris', value: 38 },
            { label: 'Madrid', value: 30 },
            { label: 'Other', value: 82 },
          ]}
        />
      </ChartCard>
    </AutoGrid>
  ),
};

const contract = [
  { label: 'Permanent', value: 60 },
  { label: 'Fixed term', value: 30 },
  { label: 'Contractor', value: 10 },
];

export const Sizes: Story = {
  name: 'Sizes',
  parameters: {
    docs: {
      description: {
        story:
          'The ring keeps its proportions at every size, and the centre figure is sized to the ring rather than the page. `thin` draws the narrower ring for a single share read like progress. Below about 100px a `Stat` with a sparkline says more in the same space.',
      },
    },
  },
  render: () => (
    <div className="flex flex-wrap items-center gap-5">
      {[64, 110].map((size) => (
        <DonutChart
          key={size}
          label={`Contract mix at ${String(size)}px`}
          size={size}
          showLegend={false}
          center="60%"
          data={contract}
        />
      ))}
      <DonutChart
        label="Contract mix at 160px"
        size={160}
        showLegend={false}
        center="60%"
        centerLabel="Permanent"
        data={contract}
      />
      <DonutChart
        label="Permanent share, thin ring"
        size={110}
        thin
        showLegend={false}
        center="72%"
        data={[
          { label: 'Permanent', value: 72 },
          { label: 'Other', value: 28, tone: 'neutral' },
        ]}
      />
    </div>
  ),
};
