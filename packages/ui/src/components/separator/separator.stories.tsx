import type { Meta, StoryObj } from '@storybook/react-vite';

import { Separator } from './separator';

const meta = {
  title: 'Components/Separator',
  component: Separator,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: [
          'A dividing line.',
          '',
          '### `decorative` is the whole design',
          '',
          'It defaults to `true`, which hides the line from assistive technology. That is right almost always: a rule between two rows of a card is a visual rhythm, and announcing "separator" between every pair of rows makes a screen reader unusable.',
          '',
          'Pass `decorative={false}` only when the line genuinely divides two *sections* a screen-reader user should hear as distinct, then it renders `role="separator"` and is announced once, meaningfully.',
          '',
          '### Before reaching for one',
          '',
          'Most of the time the answer is space, not a line. A separator earns its place when two groups sit close enough that whitespace alone reads as one group, a toolbar of mixed action types, a card footer, a menu of unrelated commands.',
        ].join('\n'),
      },
    },
  },
  argTypes: {
    orientation: {
      description:
        'Horizontal fills the width; vertical fills the height, which means the parent needs one, a vertical separator in an `items-start` flex row is invisible.',
      control: 'inline-radio',
      options: ['horizontal', 'vertical'],
      table: {
        type: { summary: "'horizontal' | 'vertical'" },
        defaultValue: { summary: 'horizontal' },
        category: 'Appearance',
      },
    },
    decorative: {
      description:
        'When true (the default) the line is hidden from assistive tech. Set it false only for a genuine section break.',
      control: 'boolean',
      table: {
        type: { summary: 'boolean' },
        defaultValue: { summary: 'true' },
        category: 'Accessibility',
      },
    },
    className: {
      description: 'For the rare case a separator needs to be inset or a different weight.',
      control: 'text',
      table: { type: { summary: 'string' }, category: 'Escape hatches' },
    },
  },
  args: { orientation: 'horizontal', decorative: true },
} satisfies Meta<typeof Separator>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: (args) => (
    <div className="max-w-md">
      {args.orientation === 'vertical' ? (
        <div className="flex h-16 items-center gap-4">
          <span className="text-base text-fg">Before</span>
          <Separator {...args} />
          <span className="text-base text-fg">After</span>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-base text-fg">Before</p>
          <Separator {...args} />
          <p className="text-base text-fg">After</p>
        </div>
      )}
    </div>
  ),
};

export const InAToolbar: Story = {
  name: 'Between groups of actions',
  parameters: {
    docs: {
      description: {
        story:
          'A vertical separator between two kinds of action: view controls on the left, destructive on the right. Note the fixed height on the row: a vertical separator has no height of its own.',
      },
    },
  },
  render: () => (
    <div className="flex h-9 items-center gap-3 rounded-lg border border-border bg-surface px-3 text-sm text-fg-muted">
      <span>Filter</span>
      <span>Sort</span>
      <span>Group</span>
      <Separator orientation="vertical" className="h-5" />
      <span>Export</span>
      <Separator orientation="vertical" className="h-5" />
      <span className="text-danger-fg">Delete</span>
    </div>
  ),
};

export const ASectionBreak: Story = {
  name: 'A real section break',
  parameters: {
    docs: {
      description: {
        story:
          'The one case for `decorative={false}`: two genuinely different sections of a page. It is announced once, as a separator, which is information rather than noise.',
      },
    },
  },
  render: () => (
    <div className="max-w-lg space-y-6">
      <section>
        <h3 className="text-md font-semibold text-fg">Employment</h3>
        <p className="mt-1 text-sm text-fg-muted">
          Staff Engineer, Platform. Full time, effective 1 September 2026.
        </p>
      </section>
      <Separator decorative={false} />
      <section>
        <h3 className="text-md font-semibold text-fg">Compensation</h3>
        <p className="mt-1 text-sm text-fg-muted">€128,500 base. Next review 1 January 2027.</p>
      </section>
    </div>
  ),
};

export const WhitespaceInstead: Story = {
  name: 'When space is the better answer',
  parameters: {
    docs: {
      description: {
        story:
          'The same two groups, once with rules and once with space. The right-hand version is quieter and reads at least as clearly, which is the test to apply before adding a line.',
      },
    },
  },
  render: () => (
    <div className="grid gap-8 sm:grid-cols-2">
      <div className="divide-y divide-border rounded-lg border border-border bg-surface">
        {['Hired 4 Mar 2024', 'Promoted 1 Sep 2026', 'Review due 1 Jan 2027'].map((line) => (
          <p key={line} className="px-4 py-2.5 text-base text-fg">
            {line}
          </p>
        ))}
      </div>
      <div className="space-y-3 rounded-lg border border-border bg-surface p-4">
        {['Hired 4 Mar 2024', 'Promoted 1 Sep 2026', 'Review due 1 Jan 2027'].map((line) => (
          <p key={line} className="text-base text-fg">
            {line}
          </p>
        ))}
      </div>
    </div>
  ),
};
