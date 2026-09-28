import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';

import { ChartCard } from '../components/chart/chart-card';
import { WaterfallChart } from '../components/chart/waterfall-chart';

const bridge = [
  { label: '1 Jul', value: 297, total: true },
  { label: 'Hires', value: 32 },
  { label: 'Transfers in', value: 4 },
  { label: 'Leavers', value: -14 },
  { label: 'Transfers out', value: -7 },
  { label: '30 Sep', value: 312, total: true },
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
          '*Started at 297, hired 32, lost 21, ended at 312.* A bar chart of those four numbers puts 297 beside 32 and makes every movement a sliver. A waterfall floats each movement at the level the one before it left off, so the arithmetic **is** the picture and the biggest contributor is the tallest step rather than the largest total.',
          '',
          '### Totals are anchored, movements float',
          '',
          'A `total` step is drawn from the baseline, an opening balance, a closing balance, a subtotal. Everything else starts wherever the running figure had reached. Getting that the wrong way round produces a chart that looks right and adds up to nothing.',
          '',
          '### Direction is a shape as well as a colour',
          '',
          'Rises and falls differ in tone **and** carry a sign in the label beneath. `+32`, `−14`. Red and green bars alone are the same bar to around 8% of men, and this is a chart whose entire content is which way each step went.',
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
    label: 'Headcount bridge, Q3 2026',
    onSelect: fn().mockName('onSelect(step, index)'),
  },
} satisfies Meta<typeof WaterfallChart>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: (args) => (
    <ChartCard title="Headcount, Q3" value="297 → 312">
      <WaterfallChart {...args} />
    </ChartCard>
  ),
};

export const Selecting: Story = {
  name: 'Reading the biggest step',
  parameters: {
    docs: {
      description: {
        story:
          'Click a step. Here hiring drove the growth: 32 people, more than every loss together. A bar chart of the same six numbers would have made the closing total the tallest thing on the screen and the hires a sliver.',
      },
    },
  },
  render: function SelectingStory(args) {
    const [selected, setSelected] = useState<string | null>('Hires');

    return (
      <ChartCard
        title="Headcount, Q3"
        description={selected === null ? 'Select a step.' : `${selected} · click a step to read it`}
      >
        <WaterfallChart
          {...args}
          {...(selected === null ? {} : { selectedLabel: selected })}
          onSelect={(step, index) => {
            setSelected(step.label);
            args.onSelect?.(step, index);
          }}
        />
      </ChartCard>
    );
  },
};

export const CrossingZero: Story = {
  name: 'When it goes negative',
  args: {
    label: 'Budget against spend, €k',
    data: [
      { label: 'Budget', value: 40, total: true },
      { label: 'Salaries', value: -38 },
      { label: 'Contractors', value: -14 },
      { label: 'Refunds', value: 4 },
      { label: 'Balance', value: -8, total: true },
    ],
    format: (value: number) => `€${String(value)}k`,
    baseline: 'zero',
  },
  parameters: {
    docs: {
      description: {
        story:
          'Below zero, the axis line becomes the reference, so the bars hang under it. The zero line is drawn only when the chart actually crosses it: a permanent baseline on a chart that never goes negative is a line with nothing to say.',
      },
    },
  },
  render: (args) => (
    <ChartCard title="Budget vs spend, €k" value="−€18k">
      <WaterfallChart {...args} />
    </ChartCard>
  ),
};
