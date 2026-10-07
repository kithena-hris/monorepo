import type { Meta, StoryObj } from '@storybook/react-native-web-vite';

import { designDocs } from '../../docs/design.ts';
import { BubbleChart } from './part-chart.tsx';
import { ChartCard } from './parts.tsx';

const meta = {
  title: 'Charts/Bubble',
  component: BubbleChart,
  parameters: designDocs('bubble'),
} satisfies Meta<typeof BubbleChart>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Teams: Story = {
  name: 'Teams: size, tenure, engagement',
  args: {
    label: 'Teams by tenure and engagement, sized by headcount',
    summary: 'Design is the most engaged team; Support the least, and both are mid-sized.',
    xLabel: 'Tenure score',
    yLabel: 'Engagement',
    sizeLabel: 'Headcount',
    axisLabels: ['Tenure: short', 'long'],
    note: 'Up = more engaged. Size = headcount.',
    data: [
      { label: 'Eng', x: 18, y: 72, size: 124 },
      { label: 'Sales', x: 40, y: 58, size: 64 },
      { label: 'Support', x: 62, y: 40, size: 48 },
      { label: 'Design', x: 28, y: 84, size: 28 },
      { label: 'Finance', x: 76, y: 66, size: 26 },
      { label: 'People', x: 52, y: 78, size: 22 },
    ],
  },
  render: (args) => (
    <ChartCard title="Teams by engagement and tenure">
      <BubbleChart {...args} />
    </ChartCard>
  ),
};
