import type { Meta, StoryObj } from '@storybook/react-vite';

import { Badge } from './badge';

const meta = {
  title: 'Components/Badge',
  component: Badge,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: [
          'Status marker for a row, a header or a tab.',
          '',
          '**The tone is never the only signal.** Roughly one man in twelve cannot separate the success and danger washes, so the label carries the meaning and the colour merely reinforces it. A badge whose text is "•" or whose meaning depends on being green is a defect.',
          '',
          '### Choosing a tone',
          '',
          '| Tone | Means |',
          '| --- | --- |',
          '| `neutral` | No judgement: draft, archived, offboarded. |',
          '| `accent` | Notable but not a state: "Effective 1 Sep". |',
          '| `success` | A terminal good outcome: approved, active, paid. |',
          '| `warning` | Needs a human: awaiting approval, balance exceeded. |',
          '| `danger` | A terminal bad outcome: rejected, failed, expired. |',
          '| `info` | Metadata about the record: superseded, imported, synced. |',
          '',
          'A badge is not a button. If it can be pressed. It is a `Button` with `variant="subtle"`.',
        ].join('\n'),
      },
    },
  },
  argTypes: {
    tone: {
      description: 'Semantic meaning. Reinforces the label; never replaces it.',
      control: 'inline-radio',
      options: ['neutral', 'accent', 'success', 'warning', 'danger', 'info'],
      table: {
        type: { summary: "'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info'" },
        defaultValue: { summary: 'neutral' },
        category: 'Appearance',
      },
    },
    size: {
      description: '`sm` for inside table rows, `md` for headers and standalone use.',
      control: 'inline-radio',
      options: ['sm', 'md'],
      table: {
        type: { summary: "'sm' | 'md'" },
        defaultValue: { summary: 'md' },
        category: 'Appearance',
      },
    },
    dot: {
      description:
        'Adds a filled dot in the tone colour, for dense tables where a pale wash on a striped row is easy to miss.',
      control: 'boolean',
      table: {
        type: { summary: 'boolean' },
        defaultValue: { summary: 'false' },
        category: 'Appearance',
      },
    },
    children: {
      description: 'The label. Must state the status in words.',
      control: 'text',
      table: { type: { summary: 'ReactNode' }, category: 'Content' },
    },
    className: {
      control: 'text',
      table: { type: { summary: 'string' }, category: 'Escape hatches' },
    },
  },
  args: { children: 'Approved', tone: 'success', size: 'md', dot: false },
} satisfies Meta<typeof Badge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Tones: Story = {
  parameters: {
    docs: {
      description: {
        story: 'Each tone paired with the label it is actually meant to carry in this product.',
      },
    },
  },
  render: (args) => (
    <div className="flex flex-wrap items-center gap-2">
      <Badge {...args} tone="neutral">
        Draft
      </Badge>
      <Badge {...args} tone="accent">
        Effective 1 Sep
      </Badge>
      <Badge {...args} tone="success">
        Approved
      </Badge>
      <Badge {...args} tone="warning">
        Awaiting manager
      </Badge>
      <Badge {...args} tone="danger">
        Rejected
      </Badge>
      <Badge {...args} tone="info">
        Superseded
      </Badge>
    </div>
  ),
};

export const Sizes: Story = {
  parameters: {
    docs: {
      description: {
        story:
          '`sm` sits inside a 40px table row without pushing it taller; `md` is the standalone default.',
      },
    },
  },
  render: (args) => (
    <div className="flex items-center gap-3">
      <Badge {...args} size="sm">
        Small
      </Badge>
      <Badge {...args} size="md">
        Medium
      </Badge>
    </div>
  ),
};

export const WithDot: Story = {
  name: 'With a dot',
  args: { dot: true, size: 'sm' },
  parameters: {
    docs: {
      description: {
        story:
          'The dot adds a second, higher-contrast cue at small sizes. It still is not the meaning, the word beside it is.',
      },
    },
  },
  render: (args) => (
    <div className="flex flex-wrap items-center gap-2">
      <Badge {...args} tone="success">
        Active
      </Badge>
      <Badge {...args} tone="warning">
        On leave
      </Badge>
      <Badge {...args} tone="neutral">
        Offboarded
      </Badge>
    </div>
  ),
};

export const InATableRow: Story = {
  name: 'In a table row',
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        story:
          'The realistic test: at `sm` with a dot, on a surface, next to text competing for the same attention.',
      },
    },
  },
  render: () => (
    <div className="max-w-md divide-y divide-border rounded-lg border border-border bg-surface">
      {(
        [
          ['Grace Hopper', 'Active', 'success'],
          ['Ada Lovelace', 'On leave', 'warning'],
          ['Katherine Johnson', 'Offboarding', 'neutral'],
        ] as const
      ).map(([name, label, tone]) => (
        <div key={name} className="flex items-center justify-between px-4 py-2.5 text-base">
          <span>{name}</span>
          <Badge dot size="sm" tone={tone}>
            {label}
          </Badge>
        </div>
      ))}
    </div>
  ),
};
