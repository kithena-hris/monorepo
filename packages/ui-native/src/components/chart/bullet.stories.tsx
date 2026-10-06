import type { Meta, StoryObj } from '@storybook/react-native-web-vite';

import { designDocs } from '../../docs/design.ts';
import { BulletChart } from './part-chart.tsx';
import { ChartCard } from './parts.tsx';

const meta = {
  title: 'Charts/Bullet',
  component: BulletChart,
  parameters: designDocs('bullet'),
} satisfies Meta<typeof BulletChart>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Goals: Story = {
  args: {
    label: 'Q3 goals against their targets',
    summary: 'Hires and time to hire beat their targets; training and eNPS fell short.',
    data: [
      { label: 'Hires', value: 30, target: 25, max: 40, bands: [15, 25], display: '30 / 25' },
      { label: 'Training done', value: 81, target: 90, max: 100, bands: [60, 80], display: '81%' },
      { label: 'eNPS', value: 34, target: 40, max: 60, bands: [20, 40], display: '34' },
      {
        label: 'Time to hire',
        value: 24,
        target: 28,
        max: 40,
        bands: [20, 30],
        display: '24 d',
        higherIsBetter: false,
      },
    ],
  },
  render: (args) => (
    <ChartCard title="Q3 goals">
      <BulletChart {...args} />
    </ChartCard>
  ),
};
