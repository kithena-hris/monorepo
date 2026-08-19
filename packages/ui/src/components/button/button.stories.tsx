import type { Meta, StoryObj } from '@storybook/react-vite';
import { ArrowRight, Check, Download, Plus, Trash2 } from 'lucide-react';

import { Button } from './button';

const meta = {
  title: 'Components/Button',
  component: Button,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: [
          'The primary action control.',
          '',
          '**One primary button per view.** If a screen has two, one of them is really a secondary action and the visual hierarchy is lying to the user about which one matters.',
          '',
          '### Choosing a variant',
          '',
          '| Variant | Use it for |',
          '| --- | --- |',
          '| `primary` | The single action the screen exists to perform. |',
          '| `secondary` | The everyday default: cancel, back, export, filter. |',
          '| `subtle` | A promoted secondary action that must not outrank the primary. |',
          '| `ghost` | Actions inside dense surfaces: table rows, toolbars, card headers. |',
          '| `destructive` | Deletes or offboards. Always behind a confirmation. |',
          '| `link` | Inline in prose, where a rectangle would break the line. |',
          '',
          '### Guarantees',
          '',
          '- `type` defaults to `button`, so a Cancel inside a form cannot submit it.',
          '- `loading` disables the control, sets `aria-busy`, and keeps the label mounted so the button cannot resize under the pointer.',
          '- `asChild` forwards the styling to a child element, anything that navigates stays an `<a>`.',
        ].join('\n'),
      },
    },
  },
  argTypes: {
    variant: {
      description: 'Visual weight, which is the same thing as importance.',
      control: 'inline-radio',
      options: ['primary', 'secondary', 'subtle', 'ghost', 'destructive', 'link'],
      table: {
        type: { summary: "'primary' | 'secondary' | 'subtle' | 'ghost' | 'destructive' | 'link'" },
        defaultValue: { summary: 'secondary' },
        category: 'Appearance',
      },
    },
    size: {
      description:
        'Height, taken from the shared control scale so a button lines up with an input on the same row.',
      control: 'inline-radio',
      options: ['sm', 'md', 'lg'],
      table: {
        type: { summary: "'sm' | 'md' | 'lg'" },
        defaultValue: { summary: 'md' },
        category: 'Appearance',
      },
    },
    fullWidth: {
      description: 'Stretch to the container. For mobile action bars and narrow forms.',
      control: 'boolean',
      table: {
        type: { summary: 'boolean' },
        defaultValue: { summary: 'false' },
        category: 'Appearance',
      },
    },
    children: {
      description: 'The label. A verb phrase that names the act, "Approve request", not "OK".',
      control: 'text',
      table: { type: { summary: 'ReactNode' }, category: 'Content' },
    },
    startIcon: {
      description: 'Leading icon. Omit `children` for an icon-only button and pass `aria-label`.',
      control: false,
      table: { type: { summary: 'ReactNode' }, category: 'Content' },
    },
    endIcon: {
      description: 'Trailing icon. Reserve for direction, "Continue →", not decoration.',
      control: false,
      table: { type: { summary: 'ReactNode' }, category: 'Content' },
    },
    loading: {
      description:
        'Blocks interaction and shows a spinner. The label stays mounted at zero opacity so the geometry never changes.',
      control: 'boolean',
      table: {
        type: { summary: 'boolean' },
        defaultValue: { summary: 'false' },
        category: 'State',
      },
    },
    loadingLabel: {
      description:
        'Announced to assistive tech while loading. Say what is happening, not "Loading".',
      control: 'text',
      table: {
        type: { summary: 'string' },
        defaultValue: { summary: 'Loading' },
        category: 'State',
      },
    },
    disabled: {
      description:
        'Unavailable. Prefer explaining why nearby, a disabled control with no explanation is a dead end.',
      control: 'boolean',
      table: { type: { summary: 'boolean' }, category: 'State' },
    },
    asChild: {
      description: 'Render the child element instead of a `<button>`, keeping all styling.',
      control: 'boolean',
      table: {
        type: { summary: 'boolean' },
        defaultValue: { summary: 'false' },
        category: 'Behaviour',
      },
    },
    type: {
      description:
        'Defaults to `button`. Set `submit` deliberately, on the one button that submits.',
      control: 'inline-radio',
      options: ['button', 'submit', 'reset'],
      table: {
        type: { summary: "'button' | 'submit' | 'reset'" },
        defaultValue: { summary: 'button' },
        category: 'Behaviour',
      },
    },
    onClick: { action: 'clicked', table: { category: 'Events' } },
    className: {
      description:
        'Merged through `tailwind-merge`, so an override wins instead of tying on specificity.',
      control: 'text',
      table: { type: { summary: 'string' }, category: 'Escape hatches' },
    },
  },
  args: {
    children: 'Approve request',
    variant: 'primary',
    size: 'md',
    loading: false,
    disabled: false,
    fullWidth: false,
    asChild: false,
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  parameters: {
    docs: {
      description: {
        story: 'Every prop is wired to a control. Start here, then read the specific cases below.',
      },
    },
  },
};

export const Variants: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'Weight descends left to right. Two buttons of equal weight side by side means the screen has not decided what it wants the user to do.',
      },
    },
  },
  render: (args) => (
    <div className="flex flex-wrap items-center gap-3">
      <Button {...args} variant="primary">
        Primary
      </Button>
      <Button {...args} variant="secondary">
        Secondary
      </Button>
      <Button {...args} variant="subtle">
        Subtle
      </Button>
      <Button {...args} variant="ghost">
        Ghost
      </Button>
      <Button {...args} variant="destructive">
        Destructive
      </Button>
      <Button {...args} variant="link">
        Link
      </Button>
    </div>
  ),
};

export const Sizes: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'Heights come from `--spacing-control-{sm,md,lg}`, shared with `Input` and `SelectTrigger`. That is why a filter bar lines up without anyone nudging a margin.',
      },
    },
  },
  render: (args) => (
    <div className="flex items-center gap-3">
      <Button {...args} size="sm">
        Small
      </Button>
      <Button {...args} size="md">
        Medium
      </Button>
      <Button {...args} size="lg">
        Large
      </Button>
    </div>
  ),
};

export const WithIcons: Story = {
  name: 'With icons',
  parameters: {
    docs: {
      description: {
        story:
          'Icons are sized by the variant, not by the icon. An icon-only button needs an `aria-label`: the glyph is not a name, and a tooltip does not appear on touch.',
      },
    },
  },
  render: (args) => (
    <div className="flex flex-wrap items-center gap-3">
      <Button {...args} startIcon={<Plus />}>
        Add employee
      </Button>
      <Button {...args} variant="secondary" startIcon={<Download />}>
        Export CSV
      </Button>
      <Button {...args} variant="ghost" endIcon={<ArrowRight />}>
        Continue
      </Button>
      <Button {...args} variant="secondary" startIcon={<Trash2 />} aria-label="Delete record">
        {null}
      </Button>
    </div>
  ),
};

export const Loading: Story = {
  args: { loading: true, loadingLabel: 'Submitting the leave request' },
  parameters: {
    docs: {
      description: {
        story:
          'The button keeps its exact width, so a double-click never lands on whatever moved into that spot. `aria-busy` and a named `loadingLabel` carry the same fact to assistive tech.',
      },
    },
  },
  render: (args) => (
    <div className="flex items-center gap-3">
      <Button {...args}>Submit request</Button>
      <Button {...args} variant="secondary" loadingLabel="Saving the draft">
        Save draft
      </Button>
      <Button {...args} variant="destructive" size="lg" loadingLabel="Offboarding">
        Offboard
      </Button>
    </div>
  ),
};

export const Disabled: Story = {
  args: { disabled: true },
  parameters: {
    docs: {
      description: {
        story:
          'Disabled is a last resort. It communicates nothing about *why*, so where possible leave the control live and explain the failure when it is pressed.',
      },
    },
  },
  render: (args) => (
    <div className="flex items-center gap-3">
      <Button {...args} variant="primary">
        Approve
      </Button>
      <Button {...args} variant="secondary">
        Reject
      </Button>
      <Button {...args} variant="ghost">
        Reassign
      </Button>
    </div>
  ),
};

export const FullWidth: Story = {
  name: 'Full width',
  args: { fullWidth: true },
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        story: 'For narrow forms and mobile action bars, where alignment beats shrink-wrap.',
      },
    },
  },
  render: (args) => (
    <div className="mx-auto grid max-w-xs gap-2">
      <Button {...args} variant="primary">
        File request
      </Button>
      <Button {...args} variant="ghost">
        Cancel
      </Button>
    </div>
  ),
};

export const AsLink: Story = {
  name: 'As a link',
  args: { asChild: true },
  parameters: {
    docs: {
      description: {
        story:
          'Anything that navigates must stay an `<a>`. A `<button>` does not open in a new tab, does not appear in the link list a screen-reader user navigates by, and cannot be copied as a URL.',
      },
    },
  },
  render: (args) => (
    <Button {...args} variant="primary" endIcon={<ArrowRight />}>
      <a href="#directory">Open directory</a>
    </Button>
  ),
};

export const InContext: Story = {
  name: 'In context',
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        story:
          'A realistic footer: one primary, one quiet escape. The destructive action lives elsewhere, in the row menu, because it does not belong next to the action people press by reflex.',
      },
    },
  },
  render: () => (
    <div className="mx-auto max-w-md rounded-lg border border-border bg-surface">
      <div className="p-5">
        <p className="text-base font-semibold">Approve leave request</p>
        <p className="mt-1 text-sm text-fg-muted">
          Grace Hopper, 14–18 September 2026. Four working days.
        </p>
      </div>
      <div className="flex justify-end gap-2 border-t border-border px-5 py-3.5">
        <Button variant="ghost">Cancel</Button>
        <Button variant="primary" startIcon={<Check />}>
          Approve
        </Button>
      </div>
    </div>
  ),
};
