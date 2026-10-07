import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { Timer } from 'lucide-react-native';
import { useState } from 'react';

import { overlayDocs } from '../../docs/design.ts';
import { Stage, settled } from '../../docs/stage.tsx';
import { Field, FieldDescription, FieldError, FieldLabel } from '../field/field.tsx';
import { Icon } from '../icon/icon.tsx';
import { Input } from '../input/input.tsx';
import { Inline, Stack } from '../layout/layout.tsx';
import { Text } from '../text/text.tsx';
import { Toggle } from '../toggle/toggle.tsx';
import { ChoiceButton } from '../typed-fields/typed-fields.tsx';
import { TimePicker } from './time-picker.tsx';
import { formatDuration, toMinutes } from './times.ts';

const meta = {
  title: 'Forms/TimePicker',
  component: TimePicker,
  parameters: overlayDocs('time-picker'),
  // On Android the picker is a dialog: axe runs once it has faded in.
  play: settled,
} satisfies Meta<typeof TimePicker>;

export default meta;
type Story = StoryObj;

export const Playground: Story = {
  render: function PlaygroundStory() {
    const [time, setTime] = useState<string | null>('09:30');
    return (
      <Stage
        trigger={(host) => (
          <Field>
            <FieldLabel>Start</FieldLabel>
            <TimePicker
              label="Start"
              locale="en-GB"
              value={time}
              onChange={setTime}
              defaultOpen
              portalHost={host}
            />
          </Field>
        )}
      />
    );
  },
};

export const TwelveHourClocks: Story = {
  name: '12-hour clocks',
  render: function TwelveStory() {
    const [time, setTime] = useState<string | null>('09:30');
    return (
      <Stage
        trigger={(host) => (
          <Stack className="gap-2">
            <Field>
              <FieldLabel>Start (en-US)</FieldLabel>
              <TimePicker
                label="Start"
                locale="en-US"
                value={time}
                onChange={setTime}
                defaultOpen
                portalHost={host}
              />
            </Field>
            <Text variant="footnote" tone="muted">
              {`Stored as ${time ?? '—'}: always 24-hour.`}
            </Text>
          </Stack>
        )}
      />
    );
  },
};

const length = (from: string, to: string): string => {
  const minutes = toMinutes(to) - toMinutes(from);
  if (minutes <= 0) return 'Ends before it starts';
  const part = minutes <= 240 ? ' · half day' : minutes >= 450 ? ' · full day' : '';
  return `${formatDuration(minutes).replace('h', ' hours').replace('m', ' min')}${part}`;
};

export const TimeRange: Story = {
  name: 'Time range',
  render: function RangeStory() {
    const [from, setFrom] = useState<string | null>('09:00');
    const [to, setTo] = useState<string | null>('13:00');
    return (
      <Stack className="gap-2.5">
        <Field>
          <FieldLabel>From</FieldLabel>
          <TimePicker label="From" locale="en-GB" value={from} onChange={setFrom} />
        </Field>
        <Field>
          <FieldLabel>To</FieldLabel>
          <TimePicker label="To" locale="en-GB" value={to} onChange={setTo} />
          {from && to ? <FieldDescription>{length(from, to)}</FieldDescription> : null}
        </Field>
      </Stack>
    );
  },
};

const presets = [240, 360, 450, 480];

export const Duration: Story = {
  render: function DurationStory() {
    const [minutes, setMinutes] = useState(450);
    const [text, setText] = useState<string | null>(null);
    return (
      <Stack className="gap-2.5">
        <Field>
          <FieldLabel>Hours worked</FieldLabel>
          <Input
            type="duration"
            value={text ?? formatDuration(minutes)}
            onChange={(next) => {
              setText(next);
              const match = /^(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?$/i.exec(next.trim());
              if (match && (match[1] || match[2]))
                setMinutes(Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0));
            }}
            onBlur={() => {
              setText(null);
            }}
            endAdornment={<Icon icon={Timer} size={19} tone="muted" />}
          />
        </Field>
        <Inline className="gap-1.5">
          {presets.map((p) => (
            <Toggle
              key={p}
              size="sm"
              pressed={minutes === p}
              onPressedChange={() => {
                setText(null);
                setMinutes(p);
              }}
            >
              {formatDuration(p)}
            </Toggle>
          ))}
        </Inline>
      </Stack>
    );
  },
};

const zones = [
  { value: 'Europe/Berlin', label: 'CET' },
  { value: 'Europe/London', label: 'GMT' },
  { value: 'America/New_York', label: 'ET' },
  { value: 'Asia/Tokyo', label: 'JST' },
];

/** The same instant on another clock, from an offset in hours that a story can state. */
const offsets: Record<string, number> = {
  'Europe/Berlin': 1,
  'Europe/London': 0,
  'America/New_York': -5,
  'Asia/Tokyo': 9,
};

const elsewhere = (time: string, from: string, to: string): string => {
  const minutes = toMinutes(time) + ((offsets[to] ?? 0) - (offsets[from] ?? 0)) * 60;
  const wrapped = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`;
};

export const TimeZones: Story = {
  name: 'Time zones',
  render: function ZonesStory() {
    const [time, setTime] = useState<string | null>('15:00');
    const [zone, setZone] = useState('Europe/Berlin');
    return (
      <Field>
        <FieldLabel>Meeting</FieldLabel>
        <TimePicker
          label="Meeting"
          locale="en-GB"
          value={time}
          onChange={setTime}
          endAdornment={
            <ChoiceButton
              label="Time zone"
              value={zone}
              display={zones.find((z) => z.value === zone)?.label ?? zone}
              options={zones}
              onChange={setZone}
              className="text-[13px] font-semibold text-fg-muted"
            />
          }
        />
        {time ? (
          <FieldDescription>
            {`${elsewhere(time, zone, 'America/New_York')} in New York · ${elsewhere(time, zone, 'Asia/Tokyo')} in Tokyo`}
          </FieldDescription>
        ) : null}
      </Field>
    );
  },
};

export const InvalidAndDisabled: Story = {
  name: 'Invalid and disabled',
  render: function InvalidStory() {
    const [end, setEnd] = useState<string | null>('08:00');
    return (
      <Stack className="gap-3">
        <Field invalid={end !== null && end <= '09:00'}>
          <FieldLabel>End</FieldLabel>
          <TimePicker label="End" locale="en-GB" value={end} onChange={setEnd} />
          <FieldError>The end time must be after 09:00.</FieldError>
        </Field>
        <Field disabled>
          <FieldLabel>Start</FieldLabel>
          <TimePicker label="Start" locale="en-GB" value="09:00" onChange={() => undefined} />
        </Field>
      </Stack>
    );
  },
};
