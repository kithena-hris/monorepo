import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';

import { Card, CardContent, CardHeader, CardTitle } from '../components/card/card';
import { DonutChart, HorizontalBarChart } from '../components/chart/chart';
import { byStatus } from './fixtures';

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
          '### Five slices, and the cap is the design',
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
          '`center` takes the number the slices sum to. It is the fact a donut otherwise throws away, and putting anything else there, a label, a sixth slice, an icon: wastes the one piece of screen the reader is looking at.',
        ].join('\n'),
      },
    },
  },
  argTypes: {
    data: {
      description: 'Up to five slices. Each carries its own `tone` or takes one from the order.',
      control: 'object',
      table: { type: { summary: 'readonly DonutSlice[]' }, category: 'Data' },
    },
    label: { control: 'text', table: { type: { summary: 'string' }, category: 'Data' } },
    size: {
      description: 'Diameter in pixels. The stroke scales with it.',
      control: { type: 'range', min: 80, max: 260, step: 10 },
      table: {
        type: { summary: 'number' },
        defaultValue: { summary: '160' },
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
    size: 160,
    // Spies, so the **Actions** panel shows what the callback is handed and
    // when, the fastest answer to the question people actually have about a
    // chart's API.
    onSelect: fn(),
  },
} satisfies Meta<typeof DonutChart>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: (args) => (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle>Employees by status</CardTitle>
      </CardHeader>
      <CardContent>
        <DonutChart
          {...args}
          center={
            <div>
              <p className="text-xl font-semibold tabular-nums text-fg">912</p>
              <p className="text-2xs text-fg-subtle">people</p>
            </div>
          }
        />
      </CardContent>
    </Card>
  ),
};

export const TooManySlices: Story = {
  name: 'When it stops working',
  parameters: {
    docs: {
      description: {
        story:
          'Seven departments, both ways. In the donut, try to say whether Support or People Operations is larger without reading the legend, then do the same in the bars. That is the whole case for the cap.',
      },
    },
  },
  render: () => {
    const departments = [
      { label: 'Engineering', value: 312 },
      { label: 'Sales', value: 208 },
      { label: 'Customer Support', value: 141 },
      { label: 'People Operations', value: 46 },
      { label: 'Finance', value: 38 },
      { label: 'Legal & Compliance', value: 17 },
      { label: 'Facilities', value: 12 },
    ];

    return (
      <div className="grid max-w-5xl gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Seven slices</CardTitle>
          </CardHeader>
          <CardContent>
            <DonutChart label="Headcount by department" data={departments} size={160} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>The same data, as bars</CardTitle>
          </CardHeader>
          <CardContent>
            <HorizontalBarChart label="Headcount by department" data={departments} />
          </CardContent>
        </Card>
      </div>
    );
  },
};

export const Sizes: Story = {
  name: 'Sizes',
  parameters: {
    docs: {
      description: {
        story:
          'The stroke is a twelfth of the diameter, so the ring keeps its proportions at every size. Below about 100px the legend is doing all the work and a `Stat` with a sparkline would say more in the same space.',
      },
    },
  },
  render: (args) => (
    <div className="flex flex-wrap items-start gap-8">
      {[100, 140, 200].map((size) => (
        <DonutChart
          {...args}
          key={size}
          size={size}
          className="max-w-xs"
          center={<p className="text-md font-semibold tabular-nums text-fg">912</p>}
        />
      ))}
    </div>
  ),
};
