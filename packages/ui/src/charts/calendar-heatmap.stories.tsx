import type { Meta, StoryObj } from '@storybook/react-vite';

import { CalendarHeatmap, type CalendarDay } from '../components/chart/calendar-heatmap';
import { ChartCard } from '../components/chart/chart-card';

const FROM = '2026-03-02';
const TO = '2026-09-27';

/**
 * A day-by-day series with a weekly rhythm, quieter at weekends, and a few
 * spikes, computed rather than random so the picture is the same every load.
 */
function days(shape: (week: number, weekday: number) => number): CalendarDay[] {
  const start = Date.UTC(2026, 2, 2);
  const end = Date.UTC(2026, 8, 27);
  const out: CalendarDay[] = [];
  for (let time = start, index = 0; time <= end; time += 86_400_000, index += 1) {
    const value = Math.max(0, shape(Math.floor(index / 7), index % 7));
    out.push({ date: new Date(time).toISOString().slice(0, 10), value });
  }
  return out;
}

const sick = days((week, weekday) =>
  Math.round(
    (Math.sin(week * 0.7 + weekday) + 1) * 2 +
      (weekday > 4 ? -2 : 1) +
      ((week * 7 + weekday) % 5 === 0 ? 3 : 0),
  ),
);
const checkIns = days((week, weekday) =>
  weekday > 4 ? 0 : Math.round(3 + Math.cos(week * 0.5 + weekday) * 2 + (weekday === 1 ? 2 : 0)),
);

const meta = {
  title: 'Charts/Calendar heatmap',
  component: CalendarHeatmap,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Activity per day across months, such as sick days or check-ins. Weeks run left to right and Monday to Sunday top to bottom; darker means more. Dates are calendar dates, `YYYY-MM-DD`, handled in UTC, so no daylight-saving change can lose or double a day.',
      },
    },
  },
  args: {
    label: 'Sick days per day, March to September 2026',
    data: sick,
    from: FROM,
    to: TO,
    tone: 'danger',
    describe: (value: number, date: string) =>
      value === 0 ? `${date}: nobody off sick` : `${date}: ${String(value)} off sick`,
    summary: 'Sick leave clusters midweek and is lowest at weekends.',
  },
} satisfies Meta<typeof CalendarHeatmap>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SickDays: Story = {
  name: 'Sick days',
  render: (args) => (
    <ChartCard title="Sick days per day, 2026">
      <CalendarHeatmap {...args} />
    </ChartCard>
  ),
};

export const CheckIns: Story = {
  name: 'Check-ins',
  args: {
    label: 'Office check-ins per day, March to September 2026',
    data: checkIns,
    tone: 'success',
    describe: (value: number, date: string) => `${date}: ${String(value)} check-ins`,
    summary: 'Tuesdays are the busiest office day; nobody comes in at weekends.',
  },
  render: (args) => (
    <ChartCard title="Office check-ins">
      <CalendarHeatmap {...args} />
    </ChartCard>
  ),
};
