import type { Meta, StoryObj } from '@storybook/react-vite';
import { ArrowRight, ChevronDown } from 'lucide-react';
import { useState } from 'react';

import { Field, FieldControl, FieldDescription, FieldError, FieldLabel } from '../field/field';
import { Toggle } from '../toggle/toggle';
import { TimePicker } from './time-picker';

const meta = {
  title: 'Forms/TimePicker',
  component: TimePicker,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: [
          'A time of day. Type it, or pick it from a list in 15 or 30-minute steps.',
          '',
          '- **Typing is forgiving and never guesses.** `930`, `9.30`, `9:30 pm` and `21:30` are all read; `9:60` and `13 pm` are refused, and the field puts back the last good value rather than holding text it cannot store.',
          '- **The list is an editable combobox.** Focus stays in the field; `↓` opens the list on the current value, `↑`/`↓` move, `Enter` picks, `Esc` closes.',
          '- **On a phone it is the platform picker**, the wheel on iOS and the dial on Android, which also takes a hardware keyboard.',
          '- **The stored value is `HH:MM`, 24-hour, always.** The locale only decides how it is shown.',
        ].join('\n'),
      },
    },
  },
  argTypes: {
    value: { control: 'text', table: { type: { summary: 'string | null' }, category: 'State' } },
    step: { control: { type: 'number' }, table: { category: 'Behaviour' } },
    locale: { control: 'text', table: { category: 'Content' } },
    size: {
      control: 'inline-radio',
      options: ['sm', 'md', 'lg'],
      table: { category: 'Appearance' },
    },
    disabled: { control: 'boolean', table: { category: 'State' } },
  },
  args: { label: 'Start', value: '09:30', onChange: () => undefined, step: 30, locale: 'en-GB' },
} satisfies Meta<typeof TimePicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: function PlaygroundStory(args) {
    const [value, setValue] = useState<string | null>(args.value);
    return (
      <div className="max-w-60">
        <Field>
          <FieldLabel>Start</FieldLabel>
          <FieldControl>
            <TimePicker {...args} value={value} onChange={setValue} />
          </FieldControl>
        </Field>
      </div>
    );
  },
};

export const TwelveHour: Story = {
  name: '12-hour clocks',
  render: function TwelveHourStory() {
    const [value, setValue] = useState<string | null>('09:30');
    return (
      <div className="max-w-60">
        <Field>
          <FieldLabel>Start (en-US)</FieldLabel>
          <FieldControl>
            <TimePicker label="Start" locale="en-US" value={value} onChange={setValue} />
          </FieldControl>
          <FieldDescription>
            The format follows the locale. The stored value is always 24-hour: {value ?? 'none'}.
          </FieldDescription>
        </Field>
      </div>
    );
  },
};

export const Range: Story = {
  name: 'Time range',
  render: function RangeStory() {
    const [from, setFrom] = useState<string | null>('09:00');
    const [to, setTo] = useState<string | null>('13:00');
    const hours =
      from && to
        ? (Number(to.slice(0, 2)) * 60 +
            Number(to.slice(3)) -
            (Number(from.slice(0, 2)) * 60 + Number(from.slice(3)))) /
          60
        : null;
    return (
      <div className="flex max-w-lg items-start gap-2.5 touch:flex-col touch:items-stretch">
        <Field className="flex-1">
          <FieldLabel>From</FieldLabel>
          <FieldControl>
            <TimePicker label="From" value={from} onChange={setFrom} max={to ?? '23:59'} />
          </FieldControl>
        </Field>
        <ArrowRight aria-hidden className="mt-9 size-4.5 shrink-0 text-fg-subtle touch:hidden" />
        <Field className="flex-1">
          <FieldLabel>To</FieldLabel>
          <FieldControl>
            <TimePicker label="To" value={to} onChange={setTo} min={from ?? '00:00'} />
          </FieldControl>
          {hours !== null && hours > 0 ? (
            <FieldDescription>
              {hours} hours{hours === 4 ? ' · half day' : ''}
            </FieldDescription>
          ) : null}
        </Field>
      </div>
    );
  },
};

const durations = [
  ['4h', '04:00'],
  ['6h', '06:00'],
  ['7h 30m', '07:30'],
  ['8h', '08:00'],
] as const;

export const Duration: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'A duration is an `HH:MM` too, with 15-minute steps up to the longest shift, and the common answers one tap away.',
      },
    },
  },
  render: function DurationStory() {
    const [value, setValue] = useState<string | null>('07:30');
    return (
      <div className="flex max-w-60 flex-col gap-2.5">
        <Field>
          <FieldLabel>Hours worked</FieldLabel>
          <FieldControl>
            <TimePicker
              label="Hours worked"
              step={15}
              max="12:00"
              value={value}
              onChange={setValue}
            />
          </FieldControl>
        </Field>
        <div className="flex flex-wrap gap-1.5">
          {durations.map(([text, time]) => (
            <Toggle
              key={time}
              size="sm"
              variant="fill"
              pressed={value === time}
              onPressedChange={() => {
                setValue(time);
              }}
            >
              {text}
            </Toggle>
          ))}
        </div>
      </div>
    );
  },
};

export const TimeZones: Story = {
  name: 'Time zones',
  render: function TimeZonesStory() {
    const [value, setValue] = useState<string | null>('15:00');
    return (
      <div className="max-w-60">
        <Field>
          <FieldLabel>Meeting</FieldLabel>
          <FieldControl>
            <TimePicker
              label="Meeting"
              value={value}
              onChange={setValue}
              endAdornment={
                <span className="flex shrink-0 items-center gap-1 text-sm font-semibold text-fg-muted">
                  CET
                  <ChevronDown aria-hidden className="size-3.5" />
                </span>
              }
            />
          </FieldControl>
          <FieldDescription>08:00 in New York · 23:00 in Tokyo</FieldDescription>
        </Field>
      </div>
    );
  },
};

export const InvalidAndDisabled: Story = {
  name: 'Invalid and disabled',
  render: function InvalidStory() {
    const [end, setEnd] = useState<string | null>('08:00');
    return (
      <div className="flex max-w-60 flex-col gap-3">
        <Field invalid={end !== null && end <= '09:00'}>
          <FieldLabel>End</FieldLabel>
          <FieldControl>
            <TimePicker label="End" value={end} onChange={setEnd} />
          </FieldControl>
          <FieldError>The end time must be after 09:00.</FieldError>
        </Field>
        <Field disabled>
          <FieldLabel>Start</FieldLabel>
          <FieldControl>
            <TimePicker label="Start" value="09:00" onChange={() => undefined} disabled />
          </FieldControl>
        </Field>
      </div>
    );
  },
};
