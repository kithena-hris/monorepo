import type { Meta, StoryObj } from '@storybook/react-vite';

import { BulletChart } from '../components/chart/bullet-chart';
import { ChartCard } from '../components/chart/chart-card';

const meta = {
  title: 'Charts/Bullet',
  component: BulletChart,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'One measure against a target and qualitative ranges. It fits many targets into far less space than gauges: the thick bar is the value, the dark tick the target, and the shaded bands what poor and fair look like. The bar turns green once the target is met. `higherIsBetter: false` for a measure like time to hire, where under the target is the good side.',
      },
    },
  },
  args: {
    label: 'Q3 goals',
    data: [
      { label: 'Hires', value: 30, target: 25, max: 40, bands: [15, 25], display: '30 / 25' },
      {
        label: 'Training done',
        value: 81,
        target: 90,
        max: 100,
        bands: [60, 80],
        display: '81%',
      },
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
    summary: 'Hires and time to hire are on target; training and eNPS are short of it.',
  },
} satisfies Meta<typeof BulletChart>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Goals: Story = {
  render: (args) => (
    <ChartCard title="Q3 goals">
      <BulletChart {...args} />
    </ChartCard>
  ),
};
