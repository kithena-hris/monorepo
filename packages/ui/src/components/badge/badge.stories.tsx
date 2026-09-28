import type { Meta, StoryObj } from '@storybook/react-vite';

import { Bell } from 'lucide-react';
import { useState } from 'react';

import { Avatar } from '../avatar/avatar';
import { Button } from '../button/button';
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
          '| `sensitive` | Not a state but a property: handled with more care, a change waits for somebody else. Outlined, and always with its glyph. |',
          '',
          'A badge is not a button. If it can be pressed, it is a `Button` with `variant="tinted"`.',
        ].join('\n'),
      },
    },
  },
  argTypes: {
    tone: {
      description: 'Semantic meaning. Reinforces the label; never replaces it.',
      control: 'inline-radio',
      options: ['neutral', 'accent', 'success', 'warning', 'danger', 'info', 'sensitive'],
      table: {
        type: {
          summary: "'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info' | 'sensitive'",
        },
        defaultValue: { summary: 'neutral' },
        category: 'Appearance',
      },
    },
    variant: {
      description:
        '`soft` is the wash for a status among other content, `solid` the fill for the one badge that must be seen first, `outline` a property rather than a state.',
      control: 'inline-radio',
      options: ['soft', 'solid', 'outline'],
      table: {
        type: { summary: "'soft' | 'solid' | 'outline'" },
        defaultValue: { summary: 'soft' },
        category: 'Appearance',
      },
    },
    size: {
      description:
        '`xs` for a count pinned to a control, `sm` for inside table rows, `md` for headers and standalone use, `lg` beside a large title.',
      control: 'inline-radio',
      options: ['xs', 'sm', 'md', 'lg'],
      table: {
        type: { summary: "'xs' | 'sm' | 'md' | 'lg'" },
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
  args: { children: 'Approved', tone: 'success', variant: 'soft', size: 'md', dot: false },
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
      <Badge {...args} tone="sensitive">
        Sensitive
      </Badge>
    </div>
  ),
};

export const Sensitive: Story = {
  args: { tone: 'sensitive', children: 'Sensitive' },
  parameters: {
    docs: {
      description: {
        story:
          'A property of what it marks rather than a state it is in: a value handled with more care, whose change waits for somebody else. Beside a status it stays distinct, because it is outlined rather than washed and carries its own glyph.',
      },
    },
  },
  render: (args) => (
    <div className="flex flex-wrap items-center gap-2">
      <Badge {...args} />
      <Badge tone="warning">Pending approval</Badge>
    </div>
  ),
};

export const Sizes: Story = {
  parameters: {
    docs: {
      description: {
        story:
          '`xs` is a count on a control; `sm` sits inside a 40px table row without pushing it taller; `md` is the standalone default.',
      },
    },
  },
  render: (args) => (
    <div className="flex items-center gap-3">
      <Badge {...args} size="xs">
        12
      </Badge>
      <Badge {...args} size="sm">
        Small
      </Badge>
      <Badge {...args} size="md">
        Medium
      </Badge>
      <Badge {...args} size="lg">
        Large
      </Badge>
    </div>
  ),
};

export const Attention: Story = {
  args: { variant: 'solid' },
  parameters: {
    docs: {
      description: {
        story:
          '`variant="solid"`, for the one badge a screen needs seen first, or a count pinned to a control. Every tone keeps 4.5:1 in both themes; warning and info have no fill dark enough for white text, so they fill with their text colour instead.',
      },
    },
  },
  render: (args) => (
    <div className="flex flex-wrap items-center gap-2.5">
      <span className="relative inline-flex">
        <Button variant="secondary" aria-label="Notifications, 3 unread" startIcon={<Bell />} />
        <Badge
          variant="solid"
          tone="danger"
          size="xs"
          aria-hidden
          className="pointer-events-none absolute -top-0.5 -right-0.5 ring-2 ring-canvas"
        >
          3
        </Badge>
      </span>
      <Badge {...args} tone="neutral">
        Draft
      </Badge>
      <Badge {...args} tone="accent">
        New
      </Badge>
      <Badge {...args} tone="success">
        Paid
      </Badge>
      <Badge {...args} tone="warning">
        Due today
      </Badge>
      <Badge {...args} tone="danger">
        Overdue
      </Badge>
      <Badge {...args} tone="info">
        Synced
      </Badge>
    </div>
  ),
};

export const Outline: Story = {
  args: { variant: 'outline', tone: 'neutral' },
  parameters: {
    docs: {
      description: {
        story:
          'No tone colour at all. For a fact about the record that is not a status — a contract type, a location.',
      },
    },
  },
  render: (args) => (
    <div className="flex flex-wrap items-center gap-2">
      <Badge {...args}>Full time</Badge>
      <Badge {...args}>Lisbon</Badge>
      <Badge {...args} dot>
        Remote
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
    <div className="max-w-md divide-y divide-border rounded-lg bg-surface shadow-sm">
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

export const Removable: Story = {
  name: 'Removable, as a chip',
  parameters: {
    docs: {
      description: {
        story:
          '`onRemove` adds a remove control and makes the badge a chip: an applied filter, a chosen team. Only the control is a button, and its name says what goes.',
      },
    },
  },
  render: function Render() {
    const [chips, setChips] = useState(['Engineering', 'Berlin', 'Priya Shah']);
    return (
      <div className="flex flex-wrap items-center gap-2">
        {chips.map((chip, index) => (
          <Badge
            key={chip}
            size="lg"
            tone={index === 0 ? 'accent' : 'neutral'}
            onRemove={() => {
              setChips((current) => current.filter((item) => item !== chip));
            }}
            removeLabel={`Remove ${chip}`}
            className={index === 2 ? 'ps-1' : undefined}
          >
            {index === 2 ? <Avatar name={chip} size="xs" aria-hidden /> : null}
            {chip}
          </Badge>
        ))}
      </div>
    );
  },
};
