import type { Meta, StoryObj } from '@storybook/react-native-web-vite';

import { designDocs } from '../../docs/design.ts';
import { CalendarHeatmap, type CalendarDay } from './distribution-chart.tsx';
import { ChartCard } from './parts.tsx';

const meta = {
  title: 'Charts/Calendar heatmap',
  component: CalendarHeatmap,
  parameters: designDocs('calendar-heatmap'),
} satisfies Meta<typeof CalendarHeatmap>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Eighteen weeks from Monday 4 May 2026, in the design's rhythm: quieter at weekends. */
const days: CalendarDay[] = Array.from({ length: 18 * 7 }, (_, i) => {
  const week = Math.floor(i / 7);
  const day = i % 7;
  const value = Math.round(
    (Math.sin(week * 0.7 + day) + 1) * 2 + (day > 4 ? -2 : 1) + (i % 5 === 0 ? 3 : 0),
  );
  const date = new Date(Date.UTC(2026, 4, 4 + i)).toISOString().slice(0, 10);
  return { date, value: Math.max(0, value) };
});

export const SickDays: Story = {
  name: 'Sick days',
  args: {
    label: 'Sick days per day, May to August 2026',
    summary: 'Sick days cluster midweek; weekends are quiet.',
    data: days,
    from: '2026-05-04',
    to: '2026-09-06',
    tone: 'danger',
    max: 6,
    scaleLabels: ['0', '6+'],
    describe: (value, date) => `${date}: ${String(value)} off sick`,
  },
  render: (args) => (
    <ChartCard title="Sick days per day, 2026">
      <CalendarHeatmap {...args} />
    </ChartCard>
  ),
};

export const CheckIns: Story = {
  name: 'Check-ins',
  args: {
    label: 'Office check-ins per day, May to August 2026',
    data: days,
    from: '2026-05-04',
    to: '2026-09-06',
    tone: 'success',
    max: 6,
    scaleLabels: ['0', '6+'],
    describe: (value, date) => `${date}: ${String(value)} check-ins`,
  },
  render: (args) => (
    <ChartCard title="Office check-ins">
      <CalendarHeatmap {...args} />
    </ChartCard>
  ),
};
