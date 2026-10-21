import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { SlotPicker } from './slot-picker';

/** A fortnight of office hours from a fixed Monday, every half hour, weekdays only. */
const TODAY = '2026-10-19';
const SLOTS = Array.from({ length: 14 }, (_, day) => day)
  .filter((day) => ![5, 6, 12, 13].includes(day))
  .flatMap((day) =>
    Array.from({ length: 14 }, (_, i) =>
      new Date(Date.UTC(2026, 9, 19 + day, 9 + Math.floor(i / 2), (i % 2) * 30)).toISOString(),
    ),
  )
  // Wednesday the 21st is a public holiday: nothing free.
  .filter((s) => !s.startsWith('2026-10-21'));

const meta = {
  title: 'Forms/SlotPicker',
  component: SlotPicker,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: [
          'Times picked from a calendar, a day at a time: the day’s free times in a list, what was picked grouped by day as removable chips.',
          '',
          '- **A day with nothing free is struck and cannot be chosen**: a weekend, a holiday, a day everyone is away. The caller decides what is free; the picker only draws it.',
          '- **A green dot marks a day with times, an accent dot one already booked.**',
          '- **`max` caps the picks**; `max={1}` makes it a single choice.',
        ].join('\n'),
      },
    },
  },
  args: {
    label: 'Interview times',
    slots: SLOTS,
    value: [],
    onChange: () => undefined,
    today: TODAY,
    timeZone: 'UTC',
    minutes: 45,
  },
} satisfies Meta<typeof SlotPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: function PlaygroundStory(args) {
    const [value, setValue] = useState<readonly string[]>(args.value);
    return <SlotPicker {...args} value={value} onChange={setValue} />;
  },
};

export const UpToTen: Story = {
  args: { max: 10, value: [SLOTS[0] ?? '', SLOTS[3] ?? '', SLOTS[20] ?? ''] },
  render: function UpToTenStory(args) {
    const [value, setValue] = useState<readonly string[]>(args.value);
    return <SlotPicker {...args} value={value} onChange={setValue} />;
  },
};

export const OneOnly: Story = {
  args: { max: 1, booked: [SLOTS[30] ?? ''] },
  render: function OneOnlyStory(args) {
    const [value, setValue] = useState<readonly string[]>(args.value);
    return <SlotPicker {...args} value={value} onChange={setValue} />;
  },
};
