import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { useState } from 'react';

import { overlayDocs } from '../../docs/design.ts';
import { Stage, settled } from '../../docs/stage.tsx';
import { addDays, daysBetween, type DateRange, type IsoDate } from '../calendar/calendar.tsx';
import { Field, FieldDescription, FieldLabel } from '../field/field.tsx';
import { Stack } from '../layout/layout.tsx';
import { Text } from '../text/text.tsx';
import { DatePicker, type DatePickerPreset } from './date-picker.tsx';

const meta = {
  title: 'Forms/DatePicker',
  component: DatePicker,
  parameters: overlayDocs('date-picker'),
  // axe runs after this, on the open picker, not on its fade in.
  play: settled,
} satisfies Meta<typeof DatePicker>;

export default meta;
type Story = StoryObj;

const TODAY = '2026-10-01';

export const Playground: Story = {
  render: function PlaygroundStory() {
    const [day, setDay] = useState<IsoDate | null>('2026-10-14');
    return (
      <Stage
        height={600}
        trigger={(host) => (
          <Field>
            <FieldLabel>Start date</FieldLabel>
            <DatePicker
              label="Start date"
              locale="en-GB"
              today={TODAY}
              value={day}
              onChange={setDay}
              defaultOpen
              portalHost={host}
            />
          </Field>
        )}
      />
    );
  },
};

const presets = (today: IsoDate): readonly DatePickerPreset[] => [
  { label: 'Today', range: { start: today, end: today } },
  { label: 'Next week', range: { start: addDays(today, 11), end: addDays(today, 15) } },
  { label: 'Next 2 weeks', range: { start: addDays(today, 11), end: addDays(today, 22) } },
  { label: 'This month', range: { start: today, end: '2026-10-31' } },
];

export const RangeWithPresets: Story = {
  name: 'Range with presets',
  render: function RangeStory() {
    const [range, setRange] = useState<DateRange | null>({
      start: '2026-10-12',
      end: '2026-10-16',
    });
    return (
      <Stage
        height={640}
        trigger={(host) => (
          <DatePicker
            mode="range"
            label="Dates"
            locale="en-GB"
            today={TODAY}
            presets={presets(TODAY)}
            value={range}
            onChange={setRange}
            defaultOpen
            portalHost={host}
          />
        )}
      />
    );
  },
};

export const WithAValidWindow: Story = {
  name: 'With a valid window',
  render: function WindowStory() {
    const [day, setDay] = useState<IsoDate | null>('2026-10-30');
    return (
      <Stage
        height={600}
        trigger={(host) => (
          <Field>
            <FieldLabel>Last day</FieldLabel>
            <DatePicker
              label="Last day"
              locale="en-GB"
              today="2026-09-30"
              min="2026-10-06"
              max="2026-10-31"
              disabledLabel={() => 'outside the notice period'}
              value={day}
              onChange={setDay}
              defaultOpen
              portalHost={host}
            />
            <FieldDescription>Between 1 and 31 October</FieldDescription>
          </Field>
        )}
      />
    );
  },
};

/** Monday to Friday, both counted. */
const workingDays = (start: IsoDate, end: IsoDate): number => {
  let count = 0;
  for (let i = 0; i < daysBetween(start, end); i += 1) {
    const day = new Date(`${addDays(start, i)}T00:00:00Z`).getUTCDay();
    if (day !== 0 && day !== 6) count += 1;
  }
  return count;
};

const short = { weekday: 'short', day: 'numeric', month: 'short' } as const;

export const AStartAndAnEnd: Story = {
  name: 'A start and an end',
  render: function StartEndStory() {
    const [from, setFrom] = useState<IsoDate | null>('2026-10-12');
    const [to, setTo] = useState<IsoDate | null>('2026-10-16');
    return (
      <Stack className="gap-3.5">
        <Field>
          <FieldLabel>From</FieldLabel>
          <DatePicker
            label="From"
            format={short}
            value={from}
            onChange={setFrom}
            locale="en-GB"
            today={TODAY}
          />
        </Field>
        <Field>
          <FieldLabel>To</FieldLabel>
          <DatePicker
            label="To"
            format={short}
            {...(from ? { min: from } : {})}
            value={to}
            onChange={setTo}
            locale="en-GB"
            today={TODAY}
          />
        </Field>
        {from && to && to >= from ? (
          <Text variant="subhead" tone="muted">
            {`${String(workingDays(from, to))} working days`}
          </Text>
        ) : null}
      </Stack>
    );
  },
};

export const Sizes: Story = {
  render: function SizesStory() {
    const [day, setDay] = useState<IsoDate | null>('2026-10-14');
    return (
      <Stack className="gap-2.5">
        <DatePicker
          label="Date, compact"
          size="sm"
          format={{ day: 'numeric', month: 'short' }}
          value={day}
          onChange={setDay}
          locale="en-GB"
          today={TODAY}
        />
        <DatePicker label="Date" value={day} onChange={setDay} locale="en-GB" today={TODAY} />
      </Stack>
    );
  },
};
