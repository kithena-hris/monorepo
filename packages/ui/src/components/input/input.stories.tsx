import type { Meta, StoryObj } from '@storybook/react-vite';
import { Euro, Hash, Search, X } from 'lucide-react';

import { Button } from '../button/button';
import { Input, Textarea } from './input';

const meta = {
  title: 'Forms/Input',
  component: Input,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: [
          'Single-line text control.',
          '',
          'The focus ring is drawn on the **shell**, not the `<input>`, so an adornment sits inside the outline instead of beside it. That is the whole reason this component wraps rather than styling the element directly.',
          '',
          '### Rules',
          '',
          '- An input is never used without a label. Wrap it in `Field` + `FieldLabel`; a placeholder is not a label, it disappears exactly when the user needs it.',
          '- Validation state comes from `aria-invalid`, which `FieldControl` sets for you. The red border is a consequence of the ARIA, not a parallel styling flag.',
          '- Set `inputMode` and `type` honestly, a numeric field that opens a QWERTY keyboard on mobile is a defect.',
          '- Autofill is repainted to the surface token, so Chrome cannot force a yellow box that fails contrast in dark mode.',
        ].join('\n'),
      },
    },
  },
  argTypes: {
    size: {
      description: 'Height from the shared control scale, matching `Button` and `SelectTrigger`.',
      control: 'inline-radio',
      options: ['sm', 'md', 'lg'],
      table: {
        type: { summary: "'sm' | 'md' | 'lg'" },
        defaultValue: { summary: 'md' },
        category: 'Appearance',
      },
    },
    startAdornment: {
      description: 'Leading content inside the shell, a search icon, a currency symbol.',
      control: false,
      table: { type: { summary: 'ReactNode' }, category: 'Content' },
    },
    endAdornment: {
      description: 'Trailing content, a unit, a clear button, a validation tick.',
      control: false,
      table: { type: { summary: 'ReactNode' }, category: 'Content' },
    },
    placeholder: {
      description: 'An example of the expected value. Never a substitute for the label.',
      control: 'text',
      table: { type: { summary: 'string' }, category: 'Content' },
    },
    type: {
      description: 'Native input type. Drives the mobile keyboard and the browser picker.',
      control: 'select',
      options: ['text', 'email', 'password', 'number', 'date', 'search', 'tel', 'url'],
      table: {
        type: { summary: 'string' },
        defaultValue: { summary: 'text' },
        category: 'Behaviour',
      },
    },
    disabled: {
      description:
        'Unavailable. Renders on the sunken surface so it reads as inert, not merely faded.',
      control: 'boolean',
      table: { type: { summary: 'boolean' }, category: 'State' },
    },
    readOnly: {
      description:
        'Value is shown and selectable but not editable. Prefer this over `disabled` for record data.',
      control: 'boolean',
      table: { type: { summary: 'boolean' }, category: 'State' },
    },
    'aria-invalid': {
      description: 'Drives the error styling. Normally set by `FieldControl` rather than by hand.',
      control: 'boolean',
      table: { type: { summary: 'boolean' }, category: 'State' },
    },
    containerClassName: {
      description: 'Applied to the shell. `className` still lands on the `<input>` itself.',
      control: 'text',
      table: { type: { summary: 'string' }, category: 'Escape hatches' },
    },
    className: {
      control: 'text',
      table: { type: { summary: 'string' }, category: 'Escape hatches' },
    },
    onChange: { action: 'changed', table: { category: 'Events' } },
  },
  args: { placeholder: 'Ada Lovelace', size: 'md', type: 'text', disabled: false, readOnly: false },
  decorators: [
    (Story) => (
      <div className="max-w-sm">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Input>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Sizes: Story = {
  parameters: {
    docs: {
      description: {
        story: '`sm` for toolbars and filter bars, `md` for forms, `lg` for single-field pages.',
      },
    },
  },
  render: (args) => (
    <div className="grid gap-3">
      <Input {...args} size="sm" placeholder="Small" />
      <Input {...args} size="md" placeholder="Medium" />
      <Input {...args} size="lg" placeholder="Large" />
    </div>
  ),
};

export const States: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'Read-only is not disabled. Record data a user may copy but not edit should stay selectable and stay in the tab order.',
      },
    },
  },
  render: (args) => (
    <div className="grid gap-3">
      <Input {...args} placeholder="Empty" />
      <Input {...args} defaultValue="Filled" />
      <Input {...args} defaultValue="EMP-004182" readOnly />
      <Input {...args} defaultValue="Unavailable" disabled />
      <Input {...args} defaultValue="ada@" aria-invalid />
    </div>
  ),
};

export const Adornments: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'Adornments live inside the focus ring. A trailing control must be a real button, an icon that looks pressable but is a `<span>` is worse than no control.',
      },
    },
  },
  render: (args) => (
    <div className="grid gap-3">
      <Input {...args} startAdornment={<Search />} placeholder="Search the directory" />
      <Input {...args} startAdornment={<Euro />} defaultValue="4200.00" inputMode="decimal" />
      <Input
        {...args}
        endAdornment={<span className="text-xs text-fg-muted">days</span>}
        defaultValue="12"
        inputMode="numeric"
      />
      <Input
        {...args}
        defaultValue="Grace"
        endAdornment={
          <Button variant="ghost" size="sm" startIcon={<X />} aria-label="Clear search">
            {null}
          </Button>
        }
      />
      {/* Not `type="date"`. The system has a `DatePicker`, and a native date
          input renders a different control in every browser, the one thing a
          design system exists to prevent. This shows the adornment, not a date. */}
      <Input {...args} defaultValue="EMP-004182" endAdornment={<Hash />} />
    </div>
  ),
};

export const MultiLine: Story = {
  name: 'Textarea',
  parameters: {
    docs: {
      description: {
        story:
          '`autoResize` uses CSS `field-sizing: content`, no scroll-height measurement, no layout thrash, no ref. The fixed variant keeps a predictable page height when the content is unbounded.',
      },
    },
  },
  render: () => (
    <div className="grid gap-3">
      <Textarea placeholder="Fixed height, scrolls" />
      <Textarea autoResize placeholder="Grows with content" />
      <Textarea defaultValue="Read-only note" readOnly />
      <Textarea defaultValue="Rejected: dates overlap an existing request" aria-invalid />
    </div>
  ),
};
