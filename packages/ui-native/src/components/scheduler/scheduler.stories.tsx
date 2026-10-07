import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { useState } from 'react';
import { View } from 'react-native-css/components';

import { designDocs, designNote } from '../../docs/design.ts';
import { Note } from '../../docs/notes.tsx';
import { Scheduler, formatMinutes, type SchedulerEvent, type SchedulerSlot } from './scheduler.tsx';

const at = (hours: number, minutes = 0): number => hours * 60 + minutes;

const WEEK = [
  { id: 'mon', label: 'Mon 12', weekday: 'M', day: '12' },
  { id: 'tue', label: 'Tue 13', weekday: 'T', day: '13' },
  { id: 'wed', label: 'Wed 14', weekday: 'W', day: '14' },
  { id: 'thu', label: 'Thu 15', weekday: 'T', day: '15' },
  { id: 'fri', label: 'Fri 16', weekday: 'F', day: '16' },
];

const EVENTS: SchedulerEvent[] = [
  {
    id: 'e1',
    column: 'mon',
    start: at(9),
    end: at(10),
    title: 'Standup',
    detail: 'Engineering',
    tone: 'info',
  },
  {
    id: 'e2',
    column: 'mon',
    start: at(13),
    end: at(14, 30),
    title: 'Interview',
    detail: 'Hana Kim',
    tone: 'accent',
  },
  {
    id: 'e3',
    column: 'tue',
    start: at(10),
    end: at(12),
    title: 'Design review',
    detail: 'Room 3',
    tone: 'success',
  },
  { id: 'e4', column: 'wed', start: at(9), end: at(10), title: 'Standup', tone: 'info' },
  { id: 'e5', column: 'wed', start: at(11), end: at(12), title: '1:1 Jonas', tone: 'accent' },
  {
    id: 'e6',
    column: 'thu',
    start: at(9),
    end: at(17),
    title: 'Amara · Vacation',
    tone: 'warning',
  },
  { id: 'e7', column: 'fri', start: at(14), end: at(16), title: 'Offsite prep', tone: 'success' },
];

const meta = {
  title: 'Components/Scheduler',
  component: Scheduler,
  parameters: designDocs('scheduler'),
  args: { columns: WEEK, events: EVENTS, label: 'Schedule' },
} satisfies Meta<typeof Scheduler>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Day: Story = {
  args: { today: 'wed', now: at(10, 30) },
};

export const Agenda: Story = {
  render: () => (
    <Scheduler
      label="Agenda"
      view="agenda"
      columns={[
        { id: 'today', label: 'Today' },
        { id: 'tomorrow', label: 'Tomorrow' },
      ]}
      events={[
        {
          id: 'a1',
          column: 'today',
          start: at(9),
          end: at(10),
          title: 'Standup',
          detail: 'Engineering',
          tone: 'info',
        },
        {
          id: 'a2',
          column: 'today',
          start: at(11),
          end: at(12),
          title: '1:1 with Jonas',
          detail: 'Room 2',
          tone: 'accent',
        },
        {
          id: 'a3',
          column: 'tomorrow',
          start: 0,
          end: at(24),
          title: 'Amara on vacation',
          tone: 'warning',
          allDay: true,
        },
      ]}
    />
  ),
};

export const Clashes: Story = {
  parameters: designNote('scheduler', 'Clashes'),
  render: () => (
    <Scheduler
      label="Schedule"
      strip={false}
      columns={[WEEK[2] ?? { id: 'wed', label: 'Wed 14' }]}
      today="wed"
      startHour={9}
      endHour={13}
      events={[
        {
          id: 'c1',
          column: 'wed',
          start: at(9, 30),
          end: at(11),
          title: 'Interview',
          detail: 'Leo Rossi',
          tone: 'accent',
        },
        {
          id: 'c2',
          column: 'wed',
          start: at(10),
          end: at(11, 30),
          title: 'Design review',
          detail: 'Clash',
          tone: 'danger',
          clash: true,
        },
      ]}
    />
  ),
};

export const PickingASlot: Story = {
  name: 'Picking a slot',
  render: function PickStory() {
    const [slot, setSlot] = useState<SchedulerSlot>({ column: 'thu', start: at(14), end: at(15) });
    return (
      <View className="gap-2.5">
        <Scheduler
          label="Schedule"
          strip={false}
          columns={[WEEK[3] ?? { id: 'thu', label: 'Thu 15' }]}
          today="thu"
          startHour={13}
          endHour={17}
          onPickSlot={setSlot}
          events={[
            {
              id: 'slot',
              column: slot.column,
              start: slot.start,
              end: slot.end,
              title: `${formatMinutes(slot.start)} – ${formatMinutes(slot.end)}`,
              detail: 'Free for all 3',
              tone: 'success',
            },
          ]}
        />
        <Note>Drag down an empty column to pick a slot. Times snap to 15 minutes.</Note>
      </View>
    );
  },
};
