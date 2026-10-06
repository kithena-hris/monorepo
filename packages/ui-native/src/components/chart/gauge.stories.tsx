import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { View } from 'react-native-css/components';

import { designDocs } from '../../docs/design.ts';
import { ChartCard } from './parts.tsx';
import { Gauge } from './radial-chart.tsx';

const meta = {
  title: 'Charts/Gauge',
  component: Gauge,
  parameters: designDocs('gauge'),
  args: { value: 72, label: 'Hiring plan', description: 'of hiring plan' },
} satisfies Meta<typeof Gauge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: (args) => (
    <View className="items-center">
      <Gauge {...args} />
    </View>
  ),
};

export const WithATarget: Story = {
  name: 'With a target',
  render: () => (
    <View className="items-center">
      <Gauge
        value={86}
        target={90}
        tone="warning"
        label="eNPS response rate"
        description="eNPS response · target 90%"
      />
    </View>
  ),
};

export const TonesAndSizes: Story = {
  name: 'Tones and sizes',
  render: () => (
    <View className="flex-row flex-wrap items-end justify-center gap-4">
      <Gauge value={100} size={120} tone="success" display="Done" label="Onboarding tasks" />
      <Gauge value={64} size={140} label="Reviews submitted" />
      <Gauge
        value={104}
        size={120}
        tone="danger"
        display="104%"
        description="Over budget"
        label="Travel budget used"
      />
    </View>
  ),
};

export const InAStatTile: Story = {
  name: 'In a stat tile',
  render: () => (
    <View className="gap-3">
      <ChartCard title="Training complete">
        <View className="items-center">
          <Gauge value={81} size={140} label="Training complete" />
        </View>
      </ChartCard>
      <ChartCard title="Reviews submitted">
        <View className="items-center">
          <Gauge value={46} size={140} tone="warning" label="Reviews submitted" />
        </View>
      </ChartCard>
    </View>
  ),
};
