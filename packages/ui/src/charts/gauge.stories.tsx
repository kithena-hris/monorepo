import type { Meta, StoryObj } from '@storybook/react-vite';

import { ChartCard } from '../components/chart/chart-card';
import { Gauge } from '../components/chart/gauge';
import { AutoGrid } from '../components/layout/layout';

const meta = {
  title: 'Charts/Gauge',
  component: Gauge,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: [
          'Progress toward one target. Show the number large, and use a gauge only where "how close are we" is the question. For several targets, a `BulletChart` says the same in a tenth of the space.',
          '',
          'A `meter` to assistive technology, with the value, the range and the description announced together. Over the scale, the arc fills and the figure says how far over, rather than the arc wrapping round.',
        ].join('\n'),
      },
    },
  },
  args: {
    value: 72,
    label: 'Hiring plan',
    description: 'of hiring plan',
  },
} satisfies Meta<typeof Gauge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: (args) => (
    <div className="flex justify-center">
      <Gauge {...args} />
    </div>
  ),
};

export const WithATarget: Story = {
  name: 'With a target',
  args: {
    value: 86,
    target: 90,
    label: 'eNPS response rate',
    description: 'eNPS response · target 90%',
    tone: 'warning',
  },
  render: (args) => (
    <div className="flex justify-center">
      <Gauge {...args} />
    </div>
  ),
};

export const TonesAndSizes: Story = {
  name: 'Tones and sizes',
  render: () => (
    <div className="flex flex-wrap items-end justify-center gap-4">
      <Gauge value={100} label="Onboarding" display="Done" tone="success" size={120} />
      <Gauge value={64} label="Reviews submitted" size={140} />
      <Gauge
        value={104}
        label="Training budget"
        display="104%"
        description="Over budget"
        tone="danger"
        size={120}
      />
    </div>
  ),
};

export const InAStatTile: Story = {
  name: 'In a stat tile',
  render: () => (
    <AutoGrid minItemWidth="13.75rem" gap={3}>
      <ChartCard title="Training complete">
        <div className="flex justify-center">
          <Gauge value={81} label="Training complete" size={140} />
        </div>
      </ChartCard>
      <ChartCard title="Reviews submitted">
        <div className="flex justify-center">
          <Gauge value={46} label="Reviews submitted" size={140} tone="warning" />
        </div>
      </ChartCard>
    </AutoGrid>
  ),
};
