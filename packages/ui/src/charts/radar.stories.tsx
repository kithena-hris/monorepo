import type { Meta, StoryObj } from '@storybook/react-vite';

import { ChartCard } from '../components/chart/chart-card';
import { RadarChart } from '../components/chart/radar-chart';

const skills = ['Delivery', 'Quality', 'Collaboration', 'Ownership', 'Mentoring', 'Communication'];

const meta = {
  title: 'Charts/Radar',
  component: RadarChart,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Compares a few items across five to eight qualities, such as skills in a review. Good at shape ("strong on delivery, light on mentoring"), bad at precision: for a decision that turns on the numbers, use bars. Every value is in the table underneath.',
      },
    },
  },
  args: {
    label: 'Skills, Priya Shah, out of 5',
    axes: skills,
    series: [{ label: 'Priya', values: [4, 5, 4, 4, 3, 4] }],
    summary: 'Strongest on quality, at 5 of 5; lightest on mentoring, at 3.',
  },
} satisfies Meta<typeof RadarChart>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: (args) => (
    <ChartCard title="Skills · Priya Shah" className="max-w-xl">
      <RadarChart {...args} />
    </ChartCard>
  ),
};

export const ComparedWithTheLevel: Story = {
  name: 'Compared with the level',
  args: {
    label: 'Skills, Priya Shah against Senior Engineer expectations',
    series: [
      { label: 'Priya', values: [4, 5, 4, 4, 3, 4] },
      { label: 'Senior expectation', values: [4, 4, 4, 4, 4, 4] },
    ],
    summary: 'Above the level on quality, below it on mentoring, at the level elsewhere.',
  },
  render: (args) => (
    <ChartCard title="Priya vs Senior Engineer expectations" className="max-w-xl">
      <RadarChart {...args} />
    </ChartCard>
  ),
};
