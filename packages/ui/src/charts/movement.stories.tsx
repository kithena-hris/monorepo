import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';

import { Badge } from '../components/badge/badge';
import { Card, CardContent, CardHeader, CardTitle } from '../components/card/card';
import { WaterfallChart } from '../components/chart/waterfall-chart';

const bridge = [
  { label: 'Aug 2025', value: 842, total: true },
  { label: 'Hires', value: 118 },
  { label: 'Rehires', value: 9 },
  { label: 'Resignations', value: -71 },
  { label: 'Redundancies', value: -18 },
  { label: 'End of contract', value: -16 },
  { label: 'Aug 2026', value: 864, total: true },
];

const meta = {
  title: 'Charts/Movement',
  component: WaterfallChart,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: [
          'How a number got from one value to another, the **headcount bridge**, the leave-balance bridge, the payroll variance.',
          '',
          '### Why not a bar chart',
          '',
          '*Started at 842, hired 118, lost 105, ended at 864.* A bar chart of those four numbers puts 842 beside 118 and makes every movement a sliver. A waterfall floats each movement at the level the one before it left off, so the arithmetic **is** the picture and the biggest contributor is the tallest step rather than the largest total.',
          '',
          '### Totals are anchored, movements float',
          '',
          'A `total` step is drawn from the baseline, an opening balance, a closing balance, a subtotal. Everything else starts wherever the running figure had reached. Getting that the wrong way round produces a chart that looks right and adds up to nothing.',
          '',
          '### Direction is a shape as well as a colour',
          '',
          'Rises and falls differ in tone **and** carry a sign in the label beneath. `+118`, `−71`. Red and green bars alone are the same bar to around 8% of men, and this is a chart whose entire content is which way each step went.',
          '',
          'The dashed connectors are not decoration: they carry the eye along the running total rather than letting it hop between columns.',
        ].join('\n'),
      },
    },
  },
  argTypes: {
    data: { control: 'object', table: { category: 'Data' } },
    height: {
      control: { type: 'range', min: 120, max: 400, step: 20 },
      table: { category: 'Appearance' },
    },
    onSelect: { control: false, table: { category: 'Interaction' } },
    format: { control: false, table: { category: 'Data' } },
  },
  args: {
    data: bridge,
    label: 'Headcount bridge, Aug 2025 to Aug 2026',
    onSelect: fn().mockName('onSelect(step, index)'),
  },
} satisfies Meta<typeof WaterfallChart>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: (args) => (
    <Card>
      <CardHeader>
        <CardTitle>Headcount bridge</CardTitle>
        <Badge size="sm" tone="success">
          +22 net
        </Badge>
      </CardHeader>
      <CardContent>
        <WaterfallChart {...args} />
      </CardContent>
    </Card>
  ),
};

export const Selecting: Story = {
  name: 'Reading the biggest step',
  parameters: {
    docs: {
      description: {
        story:
          'Click a step. The one worth acting on here is not the largest bar. It is **resignations at −71**, which is two thirds of everything lost and the only step a retention programme can move. A bar chart of the same seven numbers would have made "Aug 2026, 864" the tallest thing on the screen.',
      },
    },
  },
  render: function SelectingStory(args) {
    const [selected, setSelected] = useState<string | null>(null);

    return (
      <Card>
        <CardHeader>
          <CardTitle>Headcount bridge</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <WaterfallChart
            {...args}
            {...(selected === null ? {} : { selectedLabel: selected })}
            onSelect={(step, index) => {
              setSelected(step.label);
              args.onSelect?.(step, index);
            }}
          />
          <p aria-live="polite" className="min-h-5 text-sm text-fg-muted">
            {selected === null ? 'Select a step.' : `Selected: ${selected}`}
          </p>
        </CardContent>
      </Card>
    );
  },
};

export const CrossingZero: Story = {
  name: 'When it goes negative',
  args: {
    label: 'Leave balance, days',
    data: [
      { label: 'Carried in', value: 4, total: true },
      { label: 'Accrued', value: 12 },
      { label: 'Taken', value: -21 },
      { label: 'Bought', value: 3 },
      { label: 'Balance', value: -2, total: true },
    ],
    format: (value: number) => `${String(value)}d`,
  },
  parameters: {
    docs: {
      description: {
        story:
          'A balance that ends below zero: someone who has taken more leave than they have earned, which payroll needs to recover. The zero line is drawn only when the chart actually crosses it: a permanent baseline on a chart that never goes negative is a line with nothing to say.',
      },
    },
  },
  render: (args) => (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle>Leave balance</CardTitle>
        <Badge size="sm" tone="danger">
          Overdrawn
        </Badge>
      </CardHeader>
      <CardContent>
        <WaterfallChart {...args} />
      </CardContent>
    </Card>
  ),
};
