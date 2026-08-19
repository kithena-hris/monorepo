import type { Meta, StoryObj } from '@storybook/react-vite';
import { Bold, Grid2x2, Italic, List, Rows3, Table2, Underline } from 'lucide-react';
import { useState } from 'react';

import { Toggle, ToggleGroup, ToggleGroupItem } from './toggle';

const meta = {
  title: 'Forms/Toggle',
  component: Toggle,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: [
          'A button that stays pressed, and the segmented control built from it.',
          '',
          '### `aria-pressed`, not `aria-checked`',
          '',
          'This is a two-state *button*, not a checkbox, and the difference is what a screen reader says out loud: "Bold, toggle button, pressed" rather than "Bold, checkbox, checked". Use a toggle where the label describes an action and the pressed state describes the current setting. Use a `Checkbox` where the label describes a value being included in a set, and a `Switch` where flipping it takes effect immediately on a setting.',
          '',
          '### `ToggleGroup`',
          '',
          '`type="single"` renders as a radio group to assistive tech, which is the correct model, "list or grid" is one value with two options, not two independent switches. `type="multiple"` is the filter case, where several can be on at once.',
          '',
          'Above four or five segments this stops working on a phone; that is a `Select`. Below `xs` the segments share the row equally rather than overflowing it.',
          '',
          '### Icon-only toggles',
          '',
          'An icon-only toggle needs an `aria-label`, always. It is the only name the control has.',
        ].join('\n'),
      },
    },
  },
  argTypes: {
    pressed: {
      description: 'Controlled pressed state. Pair with `onPressedChange`.',
      control: 'boolean',
      table: { type: { summary: 'boolean' }, category: 'State' },
    },
    defaultPressed: {
      description: 'Uncontrolled starting state.',
      control: 'boolean',
      table: {
        type: { summary: 'boolean' },
        defaultValue: { summary: 'false' },
        category: 'State',
      },
    },
    onPressedChange: {
      description: 'Fires with the new pressed state.',
      control: false,
      table: { type: { summary: '(pressed: boolean) => void' }, category: 'State' },
    },
    variant: {
      description:
        '`ghost` for a toggle inside a toolbar that already has a surface; `outline` when it stands alone and needs an edge.',
      control: 'inline-radio',
      options: ['ghost', 'outline'],
      table: {
        type: { summary: "'ghost' | 'outline'" },
        defaultValue: { summary: 'ghost' },
        category: 'Appearance',
      },
    },
    size: {
      description: 'Snaps to the same control heights as `Button`, so a mixed toolbar lines up.',
      control: 'inline-radio',
      options: ['sm', 'md', 'lg'],
      table: {
        type: { summary: "'sm' | 'md' | 'lg'" },
        defaultValue: { summary: 'md' },
        category: 'Appearance',
      },
    },
    iconOnly: {
      description: 'Square aspect for a single glyph. Requires an `aria-label`.',
      control: 'boolean',
      table: {
        type: { summary: 'boolean' },
        defaultValue: { summary: 'false' },
        category: 'Appearance',
      },
    },
    disabled: {
      description: 'Blocks interaction and drops the opacity.',
      control: 'boolean',
      table: {
        type: { summary: 'boolean' },
        defaultValue: { summary: 'false' },
        category: 'State',
      },
    },
    children: {
      description: 'The label. Omit it only for an icon-only toggle with an `aria-label`.',
      control: 'text',
      table: { type: { summary: 'ReactNode' }, category: 'Content' },
    },
    className: {
      control: 'text',
      table: { type: { summary: 'string' }, category: 'Escape hatches' },
    },
  },
  args: {
    children: 'Show archived',
    variant: 'outline',
    size: 'md',
    iconOnly: false,
    disabled: false,
    defaultPressed: false,
  },
} satisfies Meta<typeof Toggle>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Variants: Story = {
  parameters: {
    docs: {
      description: {
        story:
          "Both variants, unpressed and pressed. The pressed state changes background *and* text colour, a border colour alone is not a state change anyone notices at arm's length, let alone across a room.",
      },
    },
  },
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Toggle variant="ghost">Ghost</Toggle>
      <Toggle variant="ghost" defaultPressed>
        Ghost, pressed
      </Toggle>
      <Toggle variant="outline">Outline</Toggle>
      <Toggle variant="outline" defaultPressed>
        Outline, pressed
      </Toggle>
      <Toggle variant="outline" disabled>
        Disabled
      </Toggle>
    </div>
  ),
};

export const IconOnly: Story = {
  name: 'Icon only',
  parameters: {
    docs: {
      description: {
        story:
          'Each one carries an `aria-label`, because the glyph is not a name. Turn on a screen reader and these announce "Bold, toggle button, not pressed".',
      },
    },
  },
  render: () => (
    <div className="flex items-center gap-1 rounded-lg border border-border bg-surface p-1">
      <Toggle iconOnly aria-label="Bold">
        <Bold />
      </Toggle>
      <Toggle iconOnly aria-label="Italic" defaultPressed>
        <Italic />
      </Toggle>
      <Toggle iconOnly aria-label="Underline">
        <Underline />
      </Toggle>
    </div>
  ),
};

export const SegmentedSingle: Story = {
  name: 'Segmented, one of several',
  parameters: {
    docs: {
      description: {
        story:
          'A view switcher. This is `type="single"` with a value that can never be empty, which is why the group is a radio group and not three toggles that happen to be adjacent.',
      },
    },
  },
  render: function SegmentedStory() {
    const [view, setView] = useState('table');
    return (
      <div className="space-y-3 text-center">
        <ToggleGroup
          type="single"
          value={view}
          onValueChange={(next) => {
            // An empty string arrives when the pressed segment is pressed
            // again. A view switcher has no "no view" state, so it is ignored.
            if (next) setView(next);
          }}
          aria-label="View"
        >
          <ToggleGroupItem value="table" aria-label="Table view">
            <Table2 />
            Table
          </ToggleGroupItem>
          <ToggleGroupItem value="rows" aria-label="Row view">
            <Rows3 />
            Rows
          </ToggleGroupItem>
          <ToggleGroupItem value="grid" aria-label="Grid view">
            <Grid2x2 />
            Grid
          </ToggleGroupItem>
          <ToggleGroupItem value="list" aria-label="List view">
            <List />
            List
          </ToggleGroupItem>
        </ToggleGroup>
        <p aria-live="polite" className="text-sm text-fg-muted">
          Showing the <span className="font-medium text-fg">{view}</span> view
        </p>
      </div>
    );
  },
};

export const SegmentedMultiple: Story = {
  name: 'Segmented: several at once',
  parameters: {
    docs: {
      description: {
        story:
          'The filter case. Each segment is independently pressed, so the group is a set of toggle buttons rather than a radio group, and the live region reports the resulting filter.',
      },
    },
  },
  render: function MultiStory() {
    const [statuses, setStatuses] = useState<string[]>(['active']);
    return (
      <div className="space-y-3 text-center">
        <ToggleGroup
          type="multiple"
          value={statuses}
          onValueChange={setStatuses}
          aria-label="Status filter"
        >
          <ToggleGroupItem value="active">Active</ToggleGroupItem>
          <ToggleGroupItem value="leave">On leave</ToggleGroupItem>
          <ToggleGroupItem value="offboarding">Offboarding</ToggleGroupItem>
        </ToggleGroup>
        <p aria-live="polite" className="text-sm text-fg-muted">
          {statuses.length === 0
            ? 'No status filter: showing everyone'
            : `Filtered to ${statuses.join(', ')}`}
        </p>
      </div>
    );
  },
};

export const Sizes: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'The same control heights as `Button` and `Input`, so a toolbar mixing all three lines up on one baseline. Switch the toolbar to a phone viewport and every one of them grows to the 44px floor together.',
      },
    },
  },
  render: () => (
    <div className="flex flex-col items-center gap-3">
      {(['sm', 'md', 'lg'] as const).map((size) => (
        <ToggleGroup key={size} type="single" defaultValue="week" aria-label={`Period, ${size}`}>
          <ToggleGroupItem value="week" size={size}>
            Week
          </ToggleGroupItem>
          <ToggleGroupItem value="month" size={size}>
            Month
          </ToggleGroupItem>
          <ToggleGroupItem value="quarter" size={size}>
            Quarter
          </ToggleGroupItem>
        </ToggleGroup>
      ))}
    </div>
  ),
};
