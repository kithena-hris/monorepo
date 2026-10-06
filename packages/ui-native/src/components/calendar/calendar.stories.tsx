import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { useState } from 'react';

import { designDocs } from '../../docs/design.ts';
import { Stack } from '../layout/layout.tsx';
import { Text } from '../text/text.tsx';
import { Calendar, CalendarLegend, type DateRange, type IsoDate } from './calendar.tsx';

const meta = {
  title: 'Forms/Calendar',
  component: Calendar,
  parameters: designDocs('calendar'),
} satisfies Meta<typeof Calendar>;

export default meta;
type Story = StoryObj;

/** The design's October. Today is injected, never the clock, so the story never moves. */
const TODAY = '2026-10-01';

export const Playground: Story = {
  render: function PlaygroundStory() {
    const [day, setDay] = useState<IsoDate | null>('2026-10-14');
    return <Calendar label="Start date" today={TODAY} selected={day} onSelect={setDay} />;
  },
};

export const Range: Story = {
  render: function RangeStory() {
    const [range, setRange] = useState<DateRange>({ start: '2026-10-14', end: '2026-10-18' });
    return (
      <Calendar label="Leave" mode="range" today={TODAY} selected={range} onSelect={setRange} />
    );
  },
};

const weekend = (date: IsoDate): boolean => {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
};

export const WeekendsAndHolidaysBlocked: Story = {
  name: 'Weekends and holidays blocked',
  render: function BlockedStory() {
    const [day, setDay] = useState<IsoDate | null>(null);
    return (
      <Stack className="gap-0">
        <Calendar
          label="Working day"
          today="2026-09-30"
          month="2026-10-01"
          selected={day}
          onSelect={setDay}
          isDateDisabled={(date) => weekend(date) || date === '2026-10-03'}
          disabledLabel={(date) => (date === '2026-10-03' ? 'Day of German Unity' : 'weekend')}
        />
        <CalendarLegend items={[{ tone: 'neutral', label: '3 Oct · Day of German Unity' }]} />
      </Stack>
    );
  },
};

const yours = { tone: 'info', label: 'Your leave' } as const;
const team = { tone: 'success', label: 'Team leave' } as const;

export const ExistingLeaveMarked: Story = {
  name: 'Existing leave marked',
  render: function MarkedStory() {
    const [day, setDay] = useState<IsoDate | null>(null);
    return (
      <Stack className="gap-0">
        <Calendar
          label="Leave"
          today="2026-09-30"
          month="2026-10-01"
          selected={day}
          onSelect={setDay}
          markers={{
            '2026-10-06': yours,
            '2026-10-07': yours,
            '2026-10-08': yours,
            '2026-10-21': team,
            '2026-10-22': team,
            '2026-10-27': { tone: 'warning', label: 'Pending' },
          }}
        />
        <CalendarLegend
          items={[
            { tone: 'info', label: 'Your leave' },
            { tone: 'success', label: 'Team leave' },
            { tone: 'warning', label: 'Pending' },
          ]}
        />
      </Stack>
    );
  },
};

export const LocalesAndWeekStarts: Story = {
  name: 'Locales and week starts',
  render: () => (
    <Stack className="gap-6">
      <Stack className="gap-1">
        <Text variant="footnote" tone="muted">
          de-DE, Monday first
        </Text>
        <Calendar
          label="Kalender"
          locale="de-DE"
          weekStartsOn={1}
          today="2026-09-30"
          month="2026-10-01"
        />
      </Stack>
      <Stack className="gap-1">
        <Text variant="footnote" tone="muted">
          en-US, Sunday first
        </Text>
        <Calendar
          label="Calendar"
          locale="en-US"
          weekStartsOn={0}
          today="2026-09-30"
          month="2026-10-01"
        />
      </Stack>
    </Stack>
  ),
};
