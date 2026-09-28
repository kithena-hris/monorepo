import type { Meta, StoryObj } from '@storybook/react-vite';

import { BubbleChart } from '../components/chart/bubble-chart';
import { ChartCard } from '../components/chart/chart-card';

const meta = {
  title: 'Charts/Bubble',
  component: BubbleChart,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'A scatter plot where bubble size is a third value. Size is area, not diameter, so a team twice as big has twice the ink. Label the bubbles directly, and keep it to around a dozen: a legend of twelve hues is a matching game.',
      },
    },
  },
  args: {
    label: 'Teams by average tenure and engagement, sized by headcount',
    xLabel: 'Average tenure, years',
    yLabel: 'Engagement',
    sizeLabel: 'Headcount',
    xRange: [0, 6],
    yRange: [30, 95],
    formatX: (value: number) => value.toFixed(1),
    formatY: (value: number) => String(value),
    data: [
      { label: 'Engineering', x: 1.1, y: 72, size: 124 },
      { label: 'Sales', x: 2.4, y: 58, size: 64 },
      { label: 'Support', x: 3.7, y: 40, size: 48 },
      { label: 'Design', x: 1.7, y: 84, size: 28 },
      { label: 'Finance', x: 4.6, y: 66, size: 26 },
      { label: 'People', x: 3.1, y: 78, size: 22 },
    ],
    summary:
      'Support has the longest tenure and the lowest engagement; Design the highest engagement.',
  },
} satisfies Meta<typeof BubbleChart>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TeamsBySizeTenureAndEngagement: Story = {
  name: 'Teams: size, tenure, engagement',
  render: (args) => (
    <ChartCard title="Teams by engagement and tenure">
      <BubbleChart {...args} />
    </ChartCard>
  ),
};
