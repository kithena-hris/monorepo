import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { CalendarDays, Plus } from 'lucide-react-native';
import { useState } from 'react';

import { designDocs, designNote } from '../../docs/design.ts';
import { Avatar } from '../avatar/avatar.tsx';
import { Button } from '../button/button.tsx';
import { Card } from '../card/card.tsx';
import { EmptyState } from '../feedback/feedback.tsx';
import { Icon } from '../icon/icon.tsx';
import { Stack } from '../layout/layout.tsx';
import { SegmentedControl, SegmentedControlItem } from '../segmented-control/segmented-control.tsx';
import { dayNumber, isoOf } from './dates.ts';
import {
  TimelineChart,
  type TimelineEntry,
  type TimelineRow,
  type TimelineUnit,
} from './timeline-chart.tsx';

const meta = {
  title: 'Charts/Timeline',
  component: TimelineChart,
  parameters: designDocs('chart-timeline'),
} satisfies Meta<typeof TimelineChart>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Twelve days from Monday 9 March 2026: the design's two working weeks. */
const FIRST = dayNumber('2026-03-09');
const day = (offset: number): string => isoOf(FIRST + offset);
const fortnight = { start: day(0), end: day(11) };

/** An item across columns `from` to `to` (exclusive), as the design counts them. */
function entry(
  id: string,
  label: string,
  from: number,
  to: number,
  rest: Partial<TimelineEntry> = {},
): TimelineEntry {
  return { id, label, start: day(from), end: day(to - 1), ...rest };
}

const person = (name: string, items: TimelineEntry[]): TimelineRow => ({
  label: name,
  leading: <Avatar name={name} size="sm" />,
  items,
});

const cover: TimelineRow[] = [
  person('Amara Okafor', [entry('a1', 'Vacation', 0, 5, { tone: 'info' })]),
  person('Omar Haddad', [entry('o1', 'Sick', 2, 4, { tone: 'danger' })]),
  person('Priya Shah', [entry('p1', 'Vacation', 7, 12, { tone: 'info' })]),
  person('Yuki Sato', [entry('y1', 'Training', 4, 5, { tone: 'accent' })]),
];

export const Playground: Story = {
  args: {
    label: 'Who is away, 9 to 20 March',
    summary:
      'Amara is on vacation the first week and Priya the second; Omar is off sick on Wednesday and Thursday.',
    rows: cover,
    domain: fortnight,
    today: day(2),
  },
};

export const Shapes: Story = {
  args: {
    label: 'Bar shapes, September to January',
    domain: { start: '2026-09-01', end: '2027-01-31' },
    unit: 'month',
    rows: [
      {
        label: 'Bar',
        items: [{ id: 's1', label: 'Payroll migration', start: '2026-09-01', end: '2026-10-15' }],
      },
      {
        label: 'Pill',
        items: [
          {
            id: 's2',
            label: 'Hiring freeze',
            start: '2026-10-01',
            end: '2026-11-30',
            shape: 'pill',
            tone: 'warning',
          },
        ],
      },
      {
        label: 'Milestone',
        items: [{ id: 's3', label: 'Go live', start: '2026-11-12', tone: 'success' }],
      },
      {
        label: 'Tentative',
        items: [
          { id: 's4', label: 'Q1 plan', start: '2026-12-01', end: '2027-01-18', tentative: true },
        ],
      },
    ],
  },
};

function Units(): React.JSX.Element {
  const [unit, setUnit] = useState<TimelineUnit>('week');
  return (
    <Stack gap={3}>
      <SegmentedControl
        value={unit}
        onValueChange={(next) => {
          setUnit(next as TimelineUnit);
        }}
        size="sm"
        accessibilityLabel="Scale"
      >
        <SegmentedControlItem value="day">Day</SegmentedControlItem>
        <SegmentedControlItem value="week">Week</SegmentedControlItem>
        <SegmentedControlItem value="month">Month</SegmentedControlItem>
      </SegmentedControl>
      <TimelineChart
        label="Onboarding, reviews and payroll, autumn 2026"
        unit={unit}
        today="2026-10-07"
        domain={
          unit === 'day'
            ? { start: '2026-10-05', end: '2026-10-16' }
            : unit === 'week'
              ? { start: '2026-09-28', end: '2026-11-08' }
              : { start: '2026-09-01', end: '2026-12-31' }
        }
        rows={[
          {
            label: 'Onboarding',
            items: [
              { id: 'u1', label: 'Lucas', start: '2026-09-28', end: '2026-10-11', tone: 'accent' },
            ],
          },
          {
            label: 'Reviews',
            items: [
              { id: 'u2', label: 'Mid-year', start: '2026-10-05', end: '2026-10-25', tone: 'info' },
            ],
          },
          { label: 'Payroll', items: [{ id: 'u3', label: 'Run', start: '2026-10-23' }] },
        ]}
      />
    </Stack>
  );
}

export const DayWeekMonth: Story = {
  name: 'Day, week, month',
  args: { label: '', rows: [], domain: fortnight },
  render: () => <Units />,
};

function Picking(): React.JSX.Element {
  const [range, setRange] = useState({ start: day(2), end: day(4) });
  return (
    <TimelineChart
      label="Who is away, 9 to 20 March"
      summary="Wednesday 11 to Friday 13 March is selected."
      rows={cover}
      domain={fortnight}
      selection={range}
      onSelectionChange={setRange}
    />
  );
}

export const ZoomDragAndSelect: Story = {
  name: 'Zoom, drag and select',
  parameters: designNote('chart-timeline', 'Zoom, drag and select'),
  args: { label: '', rows: [], domain: fortnight },
  render: () => <Picking />,
};

export const LeaveCover: Story = {
  name: 'Leave cover',
  args: {
    label: 'Design team cover, 9 to 20 March',
    summary: 'On Wednesday and Thursday only one designer is in; the team needs two.',
    domain: fortnight,
    rows: [
      {
        label: 'Design team',
        tone: 'chart-2',
        items: [entry('d0', 'Needs 2 people in', 0, 12, { tone: 'neutral', tentative: true })],
      },
      person('Amara Okafor', [entry('d1', 'Vacation', 0, 5, { tone: 'info' })]),
      person('Hana Kim', [entry('d2', 'Sick', 2, 4, { tone: 'danger' })]),
      {
        label: 'Cover gap',
        items: [entry('d3', 'Only 1 in', 2, 4, { tone: 'danger', emphasis: true })],
      },
    ],
  },
};

export const NothingScheduled: Story = {
  name: 'Nothing scheduled',
  args: { label: '', rows: [], domain: fortnight },
  render: () => (
    <Card>
      <EmptyState
        icon={CalendarDays}
        title="Nothing scheduled this week"
        description="Leave, training and on-call shifts will show up here."
        action={
          <Button size="sm" startIcon={<Icon icon={Plus} />}>
            Add an entry
          </Button>
        }
      />
    </Card>
  ),
};

export const WhenItemsCollide: Story = {
  name: 'When items collide',
  parameters: designNote('chart-timeline', 'When items collide'),
  args: {
    label: 'Priya and Omar, 9 to 20 March',
    summary: 'Priya is on call during her vacation, which clashes.',
    domain: fortnight,
    shadeWeekends: false,
    rows: [
      person('Priya Shah', [
        entry('c1', 'Vacation', 0, 4, { tone: 'info' }),
        entry('c2', 'On call', 2, 3, { tone: 'warning', clash: true }),
        entry('c3', 'Training', 6, 9, { tone: 'accent' }),
      ]),
      person('Omar Haddad', [entry('c4', 'Conference', 3, 6, { tone: 'accent' })]),
    ],
  },
};

function Rescheduling(): React.JSX.Element {
  const [rows, setRows] = useState<TimelineRow[]>([
    person('Priya Shah', [entry('r1', 'Vacation', 8, 12, { tone: 'info' })]),
    person('Yuki Sato', [entry('r2', 'Training', 4, 5, { tone: 'accent' })]),
  ]);
  return (
    <TimelineChart
      label="Leave you can move, 9 to 20 March"
      summary="Long-press a bar and drag it to reschedule."
      rows={rows}
      domain={fortnight}
      editable
      onItemMove={(move) => {
        setRows((current) =>
          current.map((row) => ({
            ...row,
            items: row.items.map((item) => (item.id === move.id ? { ...item, ...move.to } : item)),
          })),
        );
      }}
    />
  );
}

export const DragToReschedule: Story = {
  name: 'Drag to reschedule',
  args: { label: '', rows: [], domain: fortnight },
  render: () => <Rescheduling />,
};

export const TellingLanesApart: Story = {
  name: 'Telling lanes apart',
  args: {
    label: 'Team plans, 9 to 20 March',
    domain: fortnight,
    separator: 'both',
    shadeWeekends: false,
    rows: [
      {
        label: 'Engineering',
        tone: 'chart-1',
        items: [entry('t1', 'Sprint 42', 0, 3, { tone: 'accent' })],
      },
      {
        label: 'Design',
        tone: 'chart-2',
        items: [entry('t2', 'Research', 1, 5, { tone: 'success' })],
      },
      {
        label: 'Sales',
        tone: 'chart-3',
        items: [entry('t3', 'Kick-off', 3, 8, { tone: 'warning' })],
      },
      {
        label: 'Support',
        tone: 'chart-4',
        items: [entry('t4', 'Rota', 6, 11, { tone: 'danger' })],
      },
    ],
  },
};
