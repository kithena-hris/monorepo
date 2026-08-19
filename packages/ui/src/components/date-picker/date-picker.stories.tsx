import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import type { DateRange, IsoDate } from '../calendar/calendar';
import { DatePicker, defaultPresets } from './date-picker';

const TODAY = '2026-08-09';

const meta = {
  title: 'Forms/DatePicker',
  component: DatePicker,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: [
          'A calendar behind a trigger, for a form field.',
          '',
          '### Presets are not padding',
          '',
          '"This month" and "Last quarter" are what a person filtering a payroll register actually wants, and each one saved is two months of paging, on a phone, twelve taps. They are only offered in `range` mode, because a preset for a single date is just "today".',
          '',
          '### This replaces `<input type="date">` everywhere',
          '',
          "The native control is a different widget in every browser, a wheel on iOS, a grid in Chrome, a bare text box in Firefox, which is exactly what a design system exists to stop. It also cannot **mark** a day (a public holiday, a colleague already away), cannot express a **range** as one decision, and returns a value in the browser's locale rather than an ISO string.",
          '',
          "The trade is worth naming rather than hiding: on a phone, for one unconstrained date with nothing to mark, iOS's wheel is genuinely faster than any grid. It is not worth shipping three different pickers across one product, so the system takes the consistent one and makes the grid work under a thumb instead. 36px day targets, a panel that never runs off the bottom of the viewport, and presets that remove most of the paging.",
          '',
          '### Closing behaviour',
          '',
          'A single date is a complete answer, so the panel closes on the first click. A range is not complete until the second, so it stays open: closing after the start date would be a control that discards half the input.',
        ].join('\n'),
      },
    },
  },
  argTypes: {
    mode: {
      description: '`single` or a two-ended `range`.',
      control: 'inline-radio',
      options: ['single', 'range'],
      table: {
        type: { summary: "'single' | 'range'" },
        defaultValue: { summary: 'single' },
        category: 'Behaviour',
      },
    },
    value: {
      description: 'An ISO date string, or `{ start, end }` in range mode.',
      control: false,
      table: { type: { summary: 'IsoDate | DateRange | null' }, category: 'State' },
    },
    onChange: {
      description: 'Fires with the new value.',
      control: false,
      table: { type: { summary: '(value) => void' }, category: 'State' },
    },
    label: {
      description: 'Required. Names the trigger and the calendar inside it.',
      control: 'text',
      table: { type: { summary: 'string' }, category: 'Accessibility' },
    },
    placeholder: {
      description: 'Trigger text when nothing is chosen.',
      control: 'text',
      table: {
        type: { summary: 'string' },
        defaultValue: { summary: 'Pick a date' },
        category: 'Content',
      },
    },
    presets: {
      description:
        'Quick ranges beside the grid. `defaultPresets(today)` gives this month, last month, this quarter and year to date.',
      control: false,
      table: {
        type: { summary: 'readonly { label: string; range: DateRange }[]' },
        category: 'Content',
      },
    },
    size: {
      description: 'Matches the other form controls.',
      control: 'inline-radio',
      options: ['sm', 'md', 'lg'],
      table: {
        type: { summary: "'sm' | 'md' | 'lg'" },
        defaultValue: { summary: 'md' },
        category: 'Appearance',
      },
    },
    min: {
      description: 'Earliest selectable date, inclusive.',
      control: 'text',
      table: { type: { summary: 'IsoDate' }, category: 'Constraints' },
    },
    max: {
      description: 'Latest selectable date, inclusive.',
      control: 'text',
      table: { type: { summary: 'IsoDate' }, category: 'Constraints' },
    },
    isDateDisabled: {
      description: 'Per-day veto, passed straight through to the calendar.',
      control: false,
      table: { type: { summary: '(date: IsoDate) => boolean' }, category: 'Constraints' },
    },
    markers: {
      description: 'Dots under specific days, passed straight through.',
      control: 'object',
      table: { type: { summary: 'Record<IsoDate, { tone }>' }, category: 'Content' },
    },
    locale: {
      description: 'Drives both the trigger format and the grid.',
      control: 'select',
      options: ['en-GB', 'en-US', 'es-ES', 'de-DE'],
      table: {
        type: { summary: 'string' },
        defaultValue: { summary: 'en-GB' },
        category: 'Localisation',
      },
    },
    weekStartsOn: {
      description: '0 = Sunday, 1 = Monday.',
      control: 'inline-radio',
      options: [0, 1],
      table: {
        type: { summary: '0 | 1' },
        defaultValue: { summary: '1' },
        category: 'Localisation',
      },
    },
    today: {
      description: 'Injected "today", so the docs are reproducible.',
      control: 'text',
      table: { type: { summary: 'IsoDate' }, category: 'Testing' },
    },
    disabled: {
      description: 'Blocks the trigger.',
      control: 'boolean',
      table: {
        type: { summary: 'boolean' },
        defaultValue: { summary: 'false' },
        category: 'State',
      },
    },
    className: {
      control: 'text',
      table: { type: { summary: 'string' }, category: 'Escape hatches' },
    },
  },
  args: {
    mode: 'single',
    // Required props live in `args` so no story has to repeat them; each one
    // below replaces them with real state.
    value: null,
    onChange: () => undefined,
    label: 'Effective from',
    today: TODAY,
    locale: 'en-GB',
    size: 'md',
    disabled: false,
  },
} satisfies Meta<typeof DatePicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: function PlaygroundStory(args) {
    const [value, setValue] = useState<IsoDate | null>(null);
    return (
      <div className="w-72">
        <DatePicker {...args} mode="single" value={value} onChange={setValue} />
      </div>
    );
  },
};

export const RangeWithPresets: Story = {
  name: 'Range with presets',
  args: { mode: 'range', label: 'Pay period', placeholder: 'Any period' },
  parameters: {
    docs: {
      description: {
        story:
          'The filter case. The presets are computed from the injected `today` rather than from the clock, which is also what makes them testable. On a phone the preset column moves below the grid instead of squeezing it.',
      },
    },
  },
  render: function RangeStory(args) {
    const [value, setValue] = useState<DateRange | null>(null);
    return (
      <div className="w-72">
        <DatePicker
          {...args}
          mode="range"
          value={value}
          onChange={setValue}
          presets={defaultPresets(TODAY)}
        />
      </div>
    );
  },
};

export const Constrained: Story = {
  name: 'With a valid window',
  parameters: {
    docs: {
      description: {
        story:
          'An effective date that cannot be back-dated past the last closed pay run, and cannot be set more than a year ahead. Both bounds are inclusive, and out-of-range days stay visible so the window itself is legible.',
      },
    },
  },
  render: function ConstrainedStory(args) {
    const [value, setValue] = useState<IsoDate | null>(null);
    return (
      <div className="w-72 space-y-1.5">
        <DatePicker
          {...args}
          mode="single"
          value={value}
          onChange={setValue}
          min="2026-08-01"
          max="2027-08-09"
          label="Effective from"
        />
        <p className="text-xs text-fg-muted">
          The July run is closed, so nothing earlier than 1 August can be back-dated.
        </p>
      </div>
    );
  },
};

export const InAForm: Story = {
  name: 'A start and an end',
  parameters: {
    docs: {
      description: {
        story:
          'Two single pickers wired to each other: the end cannot precede the start, and choosing a start clears an end that is now invalid rather than leaving a silently impossible pair in the form.',
      },
    },
  },
  render: function FormStory(args) {
    const [start, setStart] = useState<IsoDate | null>('2026-09-14');
    const [end, setEnd] = useState<IsoDate | null>('2026-09-16');

    return (
      <div className="grid w-[28rem] grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-fg">First day of leave</label>
          <DatePicker
            {...args}
            mode="single"
            label="First day of leave"
            value={start}
            onChange={(next) => {
              setStart(next);
              // Both are `IsoDate | null` now, so this compares dates rather
              // than first proving they are not ranges.
              if (next && end && end < next) setEnd(null);
            }}
            min={TODAY}
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-fg">Last day of leave</label>
          <DatePicker
            {...args}
            mode="single"
            label="Last day of leave"
            value={end}
            onChange={setEnd}
            min={start ?? TODAY}
          />
        </div>
      </div>
    );
  },
};

export const Sizes: Story = {
  parameters: {
    docs: {
      description: {
        story: 'The same three control heights as every other form control in the system.',
      },
    },
  },
  render: function SizeStory(args) {
    const [value, setValue] = useState<IsoDate | null>(TODAY);
    return (
      <div className="w-72 space-y-3">
        {(['sm', 'md', 'lg'] as const).map((size) => (
          <DatePicker
            key={size}
            {...args}
            mode="single"
            size={size}
            label={`Effective from, ${size}`}
            value={value}
            onChange={setValue}
          />
        ))}
      </div>
    );
  },
};
