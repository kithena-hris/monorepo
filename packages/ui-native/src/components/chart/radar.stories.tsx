import type { Meta, StoryObj } from '@storybook/react-native-web-vite';

import { designDocs } from '../../docs/design.ts';
import { ChartCard } from './parts.tsx';
import { RadarChart } from './radial-chart.tsx';

const skills = ['Delivery', 'Quality', 'Collaboration', 'Ownership', 'Mentoring', 'Communication'];

const meta = {
  title: 'Charts/Radar',
  component: RadarChart,
  parameters: designDocs('radar'),
  args: {
    label: 'Skills, Priya Shah, out of 5',
    summary: 'Strongest in quality (5); mentoring is the one at 3.',
    axes: skills,
    series: [{ label: 'Priya Shah', values: [4, 5, 4, 4, 3, 4] }],
  },
} satisfies Meta<typeof RadarChart>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: (args) => (
    <ChartCard title="Skills · Priya Shah">
      <RadarChart {...args} />
    </ChartCard>
  ),
};

export const ComparedWithTheLevel: Story = {
  name: 'Compared with the level',
  render: () => (
    <ChartCard title="Priya vs Senior Engineer expectations">
      <RadarChart
        label="Priya Shah's skills against the Senior Engineer expectation, out of 5"
        summary="Above the expectation in quality, below it in mentoring, level elsewhere."
        axes={skills}
        series={[
          { label: 'Priya', values: [4, 5, 4, 4, 3, 4] },
          { label: 'Senior expectation', values: [4, 4, 4, 4, 4, 4] },
        ]}
      />
    </ChartCard>
  ),
};
