import type { Meta, StoryObj } from '@storybook/react-vite';

import { ChartCard } from '../components/chart/chart-card';
import { RangeBar, type RangeBarSegment } from '../components/chart/range-bar';

/** Hours as a decimal, 8.5 for half past eight, printed as `08:30`. */
const clock = (hours: number): string => {
  const whole = Math.floor(hours);
  const minutes = Math.round((hours - whole) * 60);
  return `${String(whole).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
};

const hours = [7, 10, 13, 16, 19] as const;

const meta = {
  title: 'Charts/Range bar',
  component: RangeBar,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: [
          'Spans along one fixed axis: a working day from 07:00 to 19:00, a shift, a booking window. The axis is the `domain` whatever the segments are, so bars stacked for several days line up hour for hour.',
          '',
          '`hatched` marks a span that is not final (still running, planned, missing), `size="thin"` a pause inside a span, and `now` is a point on the axis passed in from the caller’s clock. Every segment is also written out in a hidden table with its times.',
        ].join('\n'),
      },
    },
  },
  args: {
    label: 'Today',
    domain: [7, 19],
    ticks: hours,
    format: clock,
    now: 12.55,
    segments: [{ start: 8.87, end: 12.55, label: 'Running', tone: 'success', pattern: 'hatched' }],
  },
} satisfies Meta<typeof RangeBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Running: Story = {
  render: (args) => (
    <ChartCard title="Today">
      <RangeBar {...args} />
    </ChartCard>
  ),
};

const week: { day: string; segments: RangeBarSegment[] }[] = [
  {
    day: 'Monday',
    segments: [
      { start: 8.9, end: 17.1, label: 'Worked', tone: 'success' },
      { start: 13, end: 13.75, label: 'Break', tone: 'chart-3', size: 'thin' },
    ],
  },
  {
    day: 'Tuesday',
    segments: [
      { start: 9, end: 17, label: 'Worked', tone: 'success' },
      { start: 17, end: 18.5, label: 'Extra', tone: 'chart-4' },
      { start: 13, end: 13.5, label: 'Break', tone: 'chart-3', size: 'thin' },
    ],
  },
  {
    day: 'Wednesday',
    segments: [
      { start: 8.75, end: 13, label: 'Worked', tone: 'success' },
      { start: 13, end: 17, label: 'No end recorded', tone: 'danger', pattern: 'hatched' },
    ],
  },
  {
    day: 'Thursday',
    segments: [{ start: 7, end: 19, label: 'Away', tone: 'chart-1' }],
  },
  {
    day: 'Friday',
    segments: [
      { start: 8.87, end: 12.55, label: 'Running', tone: 'success', pattern: 'hatched' },
      { start: 12.55, end: 17, label: 'Planned', tone: 'neutral' },
    ],
  },
];

/**
 * Five days on one axis. Only the last bar prints the hours: the bars above
 * line up with it, so repeating the labels would only add noise.
 */
export const Week: Story = {
  render: (args) => (
    <ChartCard title="This week">
      <div className="flex flex-col gap-4">
        {week.map((entry, index) => (
          <div key={entry.day} className="grid grid-cols-[6rem_minmax(0,1fr)] items-start gap-3">
            <span className="pt-1.5 text-sm font-medium text-fg-muted">{entry.day}</span>
            <RangeBar
              {...args}
              label={entry.day}
              segments={entry.segments}
              ticks={index === week.length - 1 ? hours : []}
              now={index === week.length - 1 ? 12.55 : undefined}
            />
          </div>
        ))}
      </div>
    </ChartCard>
  ),
};

/** A pause inside a span is a thin band over it, not a gap in it. */
export const WithAPause: Story = {
  args: {
    label: 'Monday',
    now: undefined,
    segments: week[0]?.segments ?? [],
  },
  render: (args) => (
    <ChartCard title="Monday">
      <RangeBar {...args} />
    </ChartCard>
  ),
};

/** `ticks={[]}` drops the axis, for a bar inside a popover or a list row. */
export const NoAxis: Story = {
  args: { ticks: [] },
  render: (args) => (
    <div className="max-w-xs">
      <RangeBar {...args} />
    </div>
  ),
};
