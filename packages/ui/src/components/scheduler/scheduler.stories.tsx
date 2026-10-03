import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { Avatar } from '../avatar/avatar';
import {
  Scheduler,
  type SchedulerColumn,
  type SchedulerEvent,
  type SchedulerRow,
  type SchedulerTone,
} from './scheduler';
import { dayColumns } from './scheduler-model';

const week = dayColumns('2026-10-12', 5, 'en-GB');
const [mon, tue, wed, thu, fri] = week.map((day) => day.id) as [
  string,
  string,
  string,
  string,
  string,
];
const at = (hours: number, minutes = 0): number => hours * 60 + minutes;

const events: SchedulerEvent[] = [
  {
    id: 'e1',
    column: mon,
    start: at(9),
    end: at(10),
    title: 'Standup',
    detail: 'Engineering',
    tone: 'info',
  },
  {
    id: 'e2',
    column: mon,
    start: at(13),
    end: at(14, 30),
    title: 'Interview',
    detail: 'Hana Kim',
    tone: 'accent',
  },
  {
    id: 'e3',
    column: tue,
    start: at(10),
    end: at(12),
    title: 'Design review',
    detail: 'Room 3',
    tone: 'success',
  },
  { id: 'e4', column: wed, start: at(9), end: at(10), title: 'Standup', tone: 'info' },
  { id: 'e5', column: wed, start: at(11), end: at(12), title: '1:1 Jonas', tone: 'accent' },
  {
    id: 'e6',
    column: thu,
    start: 0,
    end: 0,
    allDay: true,
    title: 'Amara · Vacation',
    tone: 'warning',
  },
  { id: 'e7', column: fri, start: at(14), end: at(16), title: 'Offsite prep', tone: 'success' },
];

const meta = {
  title: 'Components/Scheduler',
  component: Scheduler,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: [
          'Week and day views for interviews, rotas and meetings, with the current time and any clashes shown, and an agenda list. Presentational: it draws what it is given.',
          '',
          'A column is a day from `dayColumns()`, or a person or a room for a resource view. Times are minutes past midnight and days are calendar dates, so nothing has a time zone to drift in, and "now" is a prop read from the caller’s clock, never from `new Date()` inside.',
          '',
          'Under a finger the week shows one day at a time, with a strip of days above it to pick from.',
        ].join('\n'),
      },
    },
  },
  args: {
    label: 'Week of 12 October',
    columns: week,
    events,
    today: wed,
    now: at(10, 30),
  },
} satisfies Meta<typeof Scheduler>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Week: Story = {};

export const Agenda: Story = {
  args: {
    view: 'agenda',
    label: 'Coming up',
    columns: [
      { id: wed, label: 'Today' },
      { id: thu, label: 'Tomorrow' },
    ],
    events: [
      {
        id: 'a1',
        column: wed,
        start: at(9),
        end: at(9, 15),
        title: 'Standup',
        detail: 'Engineering',
        tone: 'info',
      },
      {
        id: 'a2',
        column: wed,
        start: at(11),
        end: at(11, 30),
        title: '1:1 with Jonas',
        detail: 'Room 2',
        tone: 'accent',
      },
      {
        id: 'a3',
        column: thu,
        start: 0,
        end: 0,
        allDay: true,
        title: 'Amara on vacation',
        tone: 'warning',
      },
    ],
  },
  render: (args) => <Scheduler {...args} className="max-w-md" />,
};

export const Clashes: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'Overlapping events sit side by side, and one the caller marks as a `clash` has a red outline. The component never decides what a clash is: two meetings in different rooms overlap without clashing.',
      },
    },
  },
  args: {
    columns: week.slice(0, 3),
    today: wed,
    startHour: 9,
    endHour: 13,
    events: [
      {
        id: 'c1',
        column: wed,
        start: at(9, 30),
        end: at(11),
        title: 'Interview',
        detail: 'Leo Rossi',
        tone: 'accent',
      },
      {
        id: 'c2',
        column: wed,
        start: at(10),
        end: at(11, 30),
        title: 'Design review',
        detail: 'Clash',
        tone: 'danger',
        clash: true,
      },
    ],
  },
};

export const PickingASlot: Story = {
  name: 'Picking a slot',
  parameters: {
    docs: {
      description: {
        story:
          'A slot offered to a candidate is just another event, in the success tone. Choosing one by dragging down a column is the caller’s gesture to build; the grid only draws the result.',
      },
    },
  },
  args: {
    columns: week.slice(0, 4),
    today: thu,
    startHour: 13,
    endHour: 17,
    events: [
      {
        id: 's1',
        column: thu,
        start: at(14),
        end: at(15),
        title: '14:00 – 15:00',
        detail: 'Free for all 3',
        tone: 'success',
      },
    ],
  },
};

export const Resources: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'Columns are people rather than days: the same grid as a resource view of one day, for booking an interview panel.',
      },
    },
  },
  args: {
    label: 'Interview panel, Wednesday 14 October',
    columns: [
      { id: 'nora', label: 'Nora Becker' },
      { id: 'jonas', label: 'Jonas Weber' },
      { id: 'mei', label: 'Mei Tanaka' },
    ],
    startHour: 9,
    endHour: 13,
    events: [
      { id: 'r1', column: 'nora', start: at(9), end: at(10), title: 'Standup', tone: 'info' },
      {
        id: 'r2',
        column: 'jonas',
        start: at(10),
        end: at(11, 30),
        title: 'Payroll sync',
        tone: 'neutral',
      },
      {
        id: 'r3',
        column: 'mei',
        start: at(11),
        end: at(12),
        title: 'Interview',
        detail: 'Hana Kim',
        tone: 'accent',
      },
    ],
  },
};

/* ------------------------------------------------------------------ */
/* Rows of days, and a month                                          */
/* ------------------------------------------------------------------ */

const OCTOBER = '2026-10-01';
const HOLIDAY = '2026-10-12';
const CLASH = '2026-10-21';
const isWeekend = (id: string): boolean => {
  const day = new Date(`${id}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
};
const october: SchedulerColumn[] = dayColumns(OCTOBER, 31, 'en-GB').map((day) => ({
  ...day,
  ...(isWeekend(day.id) ? { shade: 'muted' as const } : {}),
  ...(day.id === HOLIDAY ? { shade: 'hatched' as const, note: 'Public holiday' } : {}),
  ...(day.id === CLASH ? { clash: true, note: 'Below the minimum' } : {}),
}));
const oct = (day: number): string => `2026-10-${String(day).padStart(2, '0')}`;

const people: SchedulerRow[] = [
  'Nora Becker',
  'Jonas Weber',
  'Mei Tanaka',
  'Leo Rossi',
  'Amara Okafor',
  'Hana Kim',
  'Lucas Moreau',
].map((name, index) => ({
  id: `p${String(index)}`,
  label: name,
  leading: <Avatar name={name} size="sm" />,
  ...(index === 2 ? { highlighted: true } : {}),
}));

const span = (
  id: string,
  row: string,
  from: number,
  to: number,
  title: string,
  tone: SchedulerTone,
  tentative = false,
): SchedulerEvent => ({
  id,
  row,
  column: oct(from),
  endColumn: oct(to),
  start: 0,
  end: 0,
  allDay: true,
  title,
  tone,
  ...(tentative ? { tentative: true, detail: 'Waiting for a decision' } : {}),
});

const away: SchedulerEvent[] = [
  span('b1', 'p0', 5, 9, 'Away', 'chart-1'),
  span('b2', 'p1', 19, 23, 'Away', 'chart-1'),
  span('b3', 'p2', 20, 22, 'Requested', 'chart-1', true),
  span('b4', 'p3', 21, 21, 'Sick', 'chart-5'),
  span('b5', 'p4', 14, 16, 'Training', 'chart-2'),
  span('b6', 'p5', 26, 30, 'Away', 'chart-1', true),
  span('b7', 'p6', 1, 2, 'Personal', 'chart-2'),
];

/** People in, per working day: seven less whoever is away. */
const inPerDay: Record<string, number> = Object.fromEntries(
  october
    .filter((day) => !day.shade)
    .map((day, index) => {
      const position = october.indexOf(day);
      const out = away.filter((event) => {
        const first = october.findIndex((entry) => entry.id === event.column);
        const last = october.findIndex((entry) => entry.id === event.endColumn);
        return position >= first && position <= last;
      }).length;
      return [day.id, 7 - out - (index % 9 === 4 ? 1 : 0)];
    }),
);

export const Rows: Story = {
  name: 'Rows of days',
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        story:
          '`variant="rows"`: a row per person, a column per day, events as bars from `column` to `endColumn`. Weekends are `shade="muted"`, a holiday `shade="hatched"`, a day short of people `clash`, each with a `note` that is read out. A `tentative` bar is hatched and outlined, and says why in `detail`. `summaryRow` counts per day and turns a count below `minimum` into a badge.',
      },
    },
  },
  args: {
    variant: 'rows',
    label: 'Team A, October',
    columns: october,
    rows: people,
    events: away,
    today: oct(1),
    summaryRow: {
      label: 'In (min 5)',
      values: inPerDay,
      minimum: 5,
      belowLabel: 'below the minimum',
    },
  },
  render: (args) => (
    <div className="p-4">
      <Scheduler {...args} />
    </div>
  ),
};

const monthEvents: SchedulerEvent[] = [
  ...away.map((event) => ({
    ...event,
    title: people.find((person) => person.id === event.row)?.label.split(' ')[0] ?? '',
  })),
  span('m1', 'p0', 21, 21, 'Ines', 'chart-3'),
  span('m2', 'p0', 21, 21, 'Omar', 'chart-4'),
  span('m3', 'p0', 21, 22, 'Sven', 'chart-2', true),
];

export const Month: Story = {
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        story:
          '`view="month"` lays the day columns out in weeks, Monday first. Each day lists its events as chips, as many as `maxChips` and then "+N more"; the rest are still read out. A `tentative` chip is outlined. With `onSelect` each day is a button, and `selected` outlines it. Under a finger the chips shrink to dots.',
      },
    },
  },
  args: {
    view: 'month',
    label: 'October 2026',
    columns: october,
    events: monthEvents,
    today: oct(1),
    selected: CLASH,
  },
  render: function MonthStory(args) {
    const [selected, setSelected] = useState<string | undefined>(args.selected);
    return (
      <div className="p-4">
        <Scheduler
          {...args}
          {...(selected === undefined ? {} : { selected })}
          onSelect={setSelected}
        />
      </div>
    );
  },
};
