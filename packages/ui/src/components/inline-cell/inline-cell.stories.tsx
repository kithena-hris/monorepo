import type { Meta, StoryObj } from '@storybook/react-vite';

import { InlineCell } from './inline-cell';

const meta = {
  title: 'Components/Inline cell edit',
  component: InlineCell,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Fix a value in the grid without opening a form. Each cell is checked as you type by the caller, which passes the answer back as `status`; the reason is spoken with the input.',
      },
    },
  },
  args: { 'aria-label': 'Work location', defaultValue: 'Madrid office' },
} satisfies Meta<typeof InlineCell>;

export default meta;
type Story = StoryObj<typeof meta>;

export const States: Story = {
  render: () => (
    <div className="flex max-w-md flex-col gap-2">
      {(
        [
          ['Read', 'Madrid office', undefined, undefined],
          ['Missing', '', 'missing', 'Wanted and empty'],
          ['Invalid', '31/02/2026', 'invalid', 'Not a real date'],
          ['Fixed', '28/02/2026', 'fixed', 'Fixed, was 31/02/2026'],
          ['Saved', 'CC-100', 'saved', 'Saved'],
        ] as const
      ).map(([label, value, status, message]) => (
        <div key={label} className="flex items-center gap-2.5">
          <span className="w-18 shrink-0 text-xs font-medium text-fg-muted">{label}</span>
          <InlineCell
            aria-label={`${label} cell`}
            defaultValue={value}
            {...(status === undefined ? {} : { status })}
            {...(message === undefined ? {} : { message })}
          />
        </div>
      ))}
    </div>
  ),
};
