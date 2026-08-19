import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { Badge } from '../badge/badge';
import { Card, CardContent, CardHeader, CardTitle } from '../card/card';
import { Calendar, addDays, type DateRange, type IsoDate } from './calendar';

const TODAY = '2026-08-09';

const meta = {
  title: 'Forms/Calendar',
  component: Calendar,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: [
          'A month grid for choosing calendar dates.',
          '',
          '### Everything here is a `YYYY-MM-DD` string, never a `Date`',
          '',
          "A hire date, a leave day and a birthday are *calendar dates*: no time, no zone. The moment one becomes a `Date` it acquires the browser's zone, and a leave day booked as the 1st in Madrid is stored as the 31st for whoever renders it in São Paulo. That bug is silent, it is one day out, and it appears only for some users in some months.",
          '',
          'So the arithmetic is done on UTC timestamps, the props are strings, and the value that comes out goes straight into a Postgres `date` column with nothing in between.',
          '',
          '### `today` is injected',
          '',
          'The domain layer of this system forbids `new Date()` and injects a `Clock`. The same reasoning applies here for a different reason: a component that reads the wall clock cannot be screenshot-tested, and "today" is exactly the pixel that changes. Every story below pins it to 9 August 2026.',
          '',
          '### Six rows, always',
          '',
          'February in a common year needs five; March needs six. A grid that changes height makes the panel jump as the user pages, and in a popover it makes the panel reposition. So the grid is always 42 cells.',
          '',
          '### Week start',
          '',
          'Defaults to Monday, the ISO week, and what every European payroll calendar uses. The weekday names come from `Intl`, not from a hardcoded English array.',
        ].join('\n'),
      },
    },
  },
  argTypes: {
    mode: {
      description: '`single` returns an ISO string; `range` returns `{ start, end }`.',
      control: 'inline-radio',
      options: ['single', 'range'],
      table: {
        type: { summary: "'single' | 'range'" },
        defaultValue: { summary: 'single' },
        category: 'Behaviour',
      },
    },
    selected: {
      description: 'The current selection. A string, or a `DateRange`.',
      control: false,
      table: { type: { summary: 'IsoDate | DateRange | null' }, category: 'State' },
    },
    onSelect: {
      description:
        'Fires with the new selection. In `range` mode a click on an earlier day than the start swaps the two rather than rejecting it: dragging backwards is a normal thing to do.',
      control: false,
      table: {
        type: { summary: '(value: IsoDate | DateRange | null) => void' },
        category: 'State',
      },
    },
    month: {
      description: 'The visible month, as any date inside it. Uncontrolled if omitted.',
      control: 'text',
      table: { type: { summary: 'IsoDate' }, category: 'State' },
    },
    onMonthChange: {
      description: "Fires when the user pages. Use it to prefetch the next month's markers.",
      control: false,
      table: { type: { summary: '(month: IsoDate) => void' }, category: 'State' },
    },
    min: {
      description: 'Inclusive earliest selectable date. Earlier days render struck through.',
      control: 'text',
      table: { type: { summary: 'IsoDate' }, category: 'Constraints' },
    },
    max: {
      description: 'Inclusive latest selectable date.',
      control: 'text',
      table: { type: { summary: 'IsoDate' }, category: 'Constraints' },
    },
    isDateDisabled: {
      description:
        'Per-day veto: weekends, company holidays, blackout periods, a payroll freeze. Runs for all 42 cells, so keep it cheap.',
      control: false,
      table: { type: { summary: '(date: IsoDate) => boolean' }, category: 'Constraints' },
    },
    markers: {
      description:
        'Dots under specific days: existing leave, a public holiday, a cut-off. A map keyed by ISO date.',
      control: 'object',
      table: {
        type: { summary: "Record<IsoDate, { tone: 'accent' | 'success' | 'warning' | 'danger' }>" },
        category: 'Content',
      },
    },
    weekStartsOn: {
      description: '0 = Sunday, 1 = Monday. Do not hardcode the US week.',
      control: 'inline-radio',
      options: [0, 1],
      table: {
        type: { summary: '0 | 1' },
        defaultValue: { summary: '1' },
        category: 'Localisation',
      },
    },
    locale: {
      description: 'BCP-47 tag. Drives the month name and the weekday names through `Intl`.',
      control: 'select',
      options: ['en-GB', 'en-US', 'es-ES', 'de-DE', 'fr-FR', 'nl-NL'],
      table: {
        type: { summary: 'string' },
        defaultValue: { summary: 'en-GB' },
        category: 'Localisation',
      },
    },
    today: {
      description: 'Injected "today". Pinned in every story so the docs are reproducible.',
      control: 'text',
      table: { type: { summary: 'IsoDate' }, category: 'Testing' },
    },
    label: {
      description: 'Accessible name for the group, "Leave start date", not "Calendar".',
      control: 'text',
      table: {
        type: { summary: 'string' },
        defaultValue: { summary: 'Calendar' },
        category: 'Accessibility',
      },
    },
    className: {
      control: 'text',
      table: { type: { summary: 'string' }, category: 'Escape hatches' },
    },
  },
  args: {
    mode: 'single',
    today: TODAY,
    month: TODAY,
    weekStartsOn: 1,
    locale: 'en-GB',
    label: 'Leave date',
  },
} satisfies Meta<typeof Calendar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: function PlaygroundStory(args) {
    const [selected, setSelected] = useState<IsoDate | null>(null);
    return (
      <div className="rounded-lg border border-border bg-surface p-3">
        <Calendar {...args} mode="single" selected={selected} onSelect={setSelected} />
        <p aria-live="polite" className="mt-2 text-center text-sm text-fg-muted">
          {typeof selected === 'string' ? selected : 'Nothing selected'}
        </p>
      </div>
    );
  },
};

export const RangeSelection: Story = {
  name: 'Range',
  args: { mode: 'range', label: 'Leave period' },
  parameters: {
    docs: {
      description: {
        story:
          'Click a start, then an end. Clicking before the start swaps them. The days between take the accent wash and square corners, so the range reads as one block rather than as scattered selections.',
      },
    },
  },
  render: function RangeStory(args) {
    const [range, setRange] = useState<DateRange | null>({
      start: '2026-08-17',
      end: '2026-08-21',
    });
    // Typed as a range from the start, so nothing has to be asserted back out.
    const value = range;
    const days =
      value?.start && value.end
        ? Math.round((Date.parse(value.end) - Date.parse(value.start)) / 86_400_000) + 1
        : 0;

    return (
      <div className="rounded-lg border border-border bg-surface p-3">
        <Calendar {...args} mode="range" selected={range} onSelect={setRange} />
        <p aria-live="polite" className="mt-2 text-center text-sm text-fg-muted">
          {days > 0 ? `${String(days)} calendar days selected` : 'Pick a start and an end'}
        </p>
      </div>
    );
  },
};

export const WithConstraints: Story = {
  name: 'Weekends and holidays blocked',
  parameters: {
    docs: {
      description: {
        story:
          'Weekends and two Spanish public holidays are vetoed, and nothing before today can be picked. Blocked days stay visible and struck through rather than disappearing, "you cannot book 15 August" is information, a missing cell is a rendering bug.',
      },
    },
  },
  render: function ConstrainedStory(args) {
    const holidays = new Set(['2026-08-15', '2026-08-25']);
    const [selected, setSelected] = useState<IsoDate | null>(null);

    return (
      <div className="rounded-lg border border-border bg-surface p-3">
        <Calendar
          {...args}
          mode="single"
          selected={selected}
          onSelect={setSelected}
          min={TODAY}
          isDateDisabled={(date) => {
            const day = new Date(`${date}T00:00:00Z`).getUTCDay();
            return day === 0 || day === 6 || holidays.has(date);
          }}
          markers={{
            '2026-08-15': { tone: 'danger' },
            '2026-08-25': { tone: 'danger' },
          }}
        />
        <div className="mt-2 flex items-center justify-center gap-2 text-xs text-fg-muted">
          <Badge tone="danger" size="sm" dot>
            Public holiday
          </Badge>
          Weekends are not working days in this calendar
        </div>
      </div>
    );
  },
};

export const WithMarkers: Story = {
  name: 'Existing leave marked',
  parameters: {
    docs: {
      description: {
        story:
          'Markers show what is already booked while the user picks. The dot is never the only signal, the legend spells it out, and the days remain selectable because booking over existing leave is a conflict the server should reject with a reason, not something the calendar should silently prevent.',
      },
    },
  },
  render: function MarkerStory(args) {
    const [selected, setSelected] = useState<IsoDate | null>(null);
    const markers = {
      '2026-08-10': { tone: 'accent' },
      '2026-08-11': { tone: 'accent' },
      '2026-08-12': { tone: 'accent' },
      '2026-08-15': { tone: 'danger' },
      '2026-08-27': { tone: 'warning' },
      '2026-08-28': { tone: 'warning' },
    } as const;

    return (
      <Card className="w-fit">
        <CardHeader>
          <CardTitle>August 2026</CardTitle>
        </CardHeader>
        <CardContent>
          <Calendar
            {...args}
            mode="single"
            selected={selected}
            onSelect={setSelected}
            markers={markers}
          />
          <ul className="mt-3 space-y-1 text-xs text-fg-muted">
            <li className="flex items-center gap-2">
              <span className="size-1.5 rounded-full bg-accent" aria-hidden />
              Your booked leave
            </li>
            <li className="flex items-center gap-2">
              <span className="size-1.5 rounded-full bg-warning" aria-hidden />A teammate is away
            </li>
            <li className="flex items-center gap-2">
              <span className="size-1.5 rounded-full bg-danger" aria-hidden />
              Public holiday
            </li>
          </ul>
        </CardContent>
      </Card>
    );
  },
};

export const Localised: Story = {
  name: 'Locales and week starts',
  parameters: {
    docs: {
      description: {
        story:
          'The same month in four locales. Month and weekday names come from `Intl`; only `weekStartsOn` is a decision, and the default is Monday because that is the ISO week. An HRIS sold in Europe that starts its weeks on Sunday looks wrong to every user it has.',
      },
    },
  },
  render: () => (
    <div className="grid gap-6 sm:grid-cols-2">
      {(
        [
          ['en-GB', 1],
          ['en-US', 0],
          ['es-ES', 1],
          ['de-DE', 1],
        ] as const
      ).map(([locale, weekStartsOn]) => (
        <div key={locale} className="rounded-lg border border-border bg-surface p-3">
          <p className="mb-2 font-mono text-2xs text-fg-subtle">
            {locale} · week starts {weekStartsOn === 1 ? 'Monday' : 'Sunday'}
          </p>
          {/*
            No `{...args}` here. `Calendar`'s props are a union, so `args` is a
            union too, and spreading it yields a union of objects that no single
            branch accepts. This grid overrides every control it displays except
            the two below, so naming them is both simpler and honest about what
            the story actually varies.
          */}
          <Calendar
            mode="single"
            today={TODAY}
            month={TODAY}
            locale={locale}
            weekStartsOn={weekStartsOn}
            label={`Calendar, ${locale}`}
            selected={addDays(TODAY, 5)}
          />
        </div>
      ))}
    </div>
  ),
};
