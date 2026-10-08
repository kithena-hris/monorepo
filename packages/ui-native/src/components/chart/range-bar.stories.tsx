import type { Meta, StoryObj } from '@storybook/react-native-web-vite';

import { RangeBar } from './range-bar.tsx';

const time = (minutes: number): string =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

const meta = {
  title: 'Charts/Range bar',
  component: RangeBar,
  args: {
    label: 'Today',
    domain: [420, 1140],
    ticks: [420, 600, 780, 960, 1140],
    format: time,
    now: 1061,
    segments: [
      { start: 532, end: 785, label: 'Worked', tone: 'success' },
      { start: 785, end: 830, label: 'Break', tone: 'warning', size: 'thin' },
      { start: 830, end: 1061, label: 'Working now', tone: 'success', pattern: 'hatched' },
    ],
  },
} satisfies Meta<typeof RangeBar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A working day: worked, a break, and the span still running up to now. */
export const Playground: Story = {};
