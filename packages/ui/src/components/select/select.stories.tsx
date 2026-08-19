import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { Field, FieldControl, FieldDescription, FieldError, FieldLabel } from '../field/field';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from './select';

const meta = {
  title: 'Forms/Select',
  component: Select,
  subcomponents: { SelectTrigger, SelectContent, SelectItem, SelectGroup, SelectLabel },
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: [
          'Single choice from a short, known list.',
          '',
          '**Above roughly a dozen options this is the wrong component.** A four-hundred-entry cost-centre list in a select is a support ticket waiting to be filed; use a searchable combobox instead.',
          '',
          '### Composition',
          '',
          '```tsx',
          '<Select value={value} onValueChange={setValue}>',
          '  <SelectTrigger><SelectValue placeholder="Select a type" /></SelectTrigger>',
          '  <SelectContent>',
          '    <SelectItem value="annual">Annual leave</SelectItem>',
          '  </SelectContent>',
          '</Select>',
          '```',
          '',
          '### Notes',
          '',
          '- The trigger is the DOM node, so `FieldControl` wraps `SelectTrigger`, never the root.',
          '- Keyboard behaviour: typeahead, Home/End, wrap-around, Escape: comes from the primitive and must not be re-implemented.',
          '- The content matches the trigger width by default, so options never render narrower than the value they replace.',
          '- Disabled items stay in the list with a reason in the label. Silently omitting an option makes the list look wrong rather than restricted.',
        ].join('\n'),
      },
    },
  },
  argTypes: {
    value: {
      description: 'Controlled value. Pair with `onValueChange`.',
      control: 'select',
      options: ['annual', 'sick', 'parental', 'unpaid'],
      table: { type: { summary: 'string' }, category: 'Value' },
    },
    defaultValue: {
      description: 'Uncontrolled starting value.',
      control: 'text',
      table: { type: { summary: 'string' }, category: 'Value' },
    },
    disabled: {
      description: 'Disables the trigger and prevents opening.',
      control: 'boolean',
      table: { type: { summary: 'boolean' }, category: 'State' },
    },
    required: {
      description: 'Native form semantics for the hidden input the primitive renders.',
      control: 'boolean',
      table: { type: { summary: 'boolean' }, category: 'State' },
    },
    dir: {
      description: 'Reading direction. Drives arrow-key semantics, not only alignment.',
      control: 'inline-radio',
      options: ['ltr', 'rtl'],
      table: {
        type: { summary: "'ltr' | 'rtl'" },
        defaultValue: { summary: 'ltr' },
        category: 'Behaviour',
      },
    },
    onValueChange: { action: 'value changed', table: { category: 'Events' } },
    onOpenChange: { action: 'open changed', table: { category: 'Events' } },
  },
  args: { disabled: false },
  decorators: [
    (Story) => (
      <div className="max-w-xs">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Select>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  args: { defaultValue: 'annual' },
  render: (args) => (
    <Select {...args}>
      <SelectTrigger aria-label="Leave type">
        <SelectValue placeholder="Select a leave type" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="annual">Annual leave</SelectItem>
        <SelectItem value="sick">Sick leave</SelectItem>
        <SelectItem value="parental">Parental leave</SelectItem>
        <SelectItem value="unpaid">Unpaid leave</SelectItem>
      </SelectContent>
    </Select>
  ),
};

export const Placeholder: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'With no value the placeholder renders in the subtle foreground, which is visibly not a selected value, an empty select that looks filled is how a form gets submitted with the first option nobody chose.',
      },
    },
  },
  render: (args) => (
    <Select {...args}>
      <SelectTrigger aria-label="Cost centre">
        <SelectValue placeholder="Select a cost centre" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="rnd">R&amp;D</SelectItem>
        <SelectItem value="ops">Operations</SelectItem>
        <SelectItem value="ga">General &amp; administrative</SelectItem>
      </SelectContent>
    </Select>
  ),
};

export const Grouped: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'Groups carry a label and a separator. The disabled item states *why* it is unavailable rather than vanishing from the list.',
      },
    },
  },
  render: (args) => (
    <Select {...args}>
      <SelectTrigger aria-label="Approver">
        <SelectValue placeholder="Choose an approver" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>Direct line</SelectLabel>
          <SelectItem value="manager">Reporting manager</SelectItem>
          <SelectItem value="skip">Skip-level manager</SelectItem>
        </SelectGroup>
        <SelectSeparator />
        <SelectGroup>
          <SelectLabel>Functional</SelectLabel>
          <SelectItem value="hrbp">HR business partner</SelectItem>
          <SelectItem value="finance" disabled>
            Finance controller, on leave
          </SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  ),
};

export const InAField: Story = {
  name: 'In a field',
  parameters: {
    docs: {
      description: {
        story:
          '`FieldControl` wraps the **trigger**. The root renders no DOM node, so there would be nothing there to carry the id or the ARIA.',
      },
    },
  },
  render: () => (
    <Field required invalid>
      <FieldLabel>Leave type</FieldLabel>
      <Select>
        <FieldControl>
          <SelectTrigger>
            <SelectValue placeholder="Select a leave type" />
          </SelectTrigger>
        </FieldControl>
        <SelectContent>
          <SelectItem value="annual">Annual leave</SelectItem>
          <SelectItem value="sick">Sick leave</SelectItem>
        </SelectContent>
      </Select>
      <FieldDescription>Determines which balance the request draws from.</FieldDescription>
      <FieldError>Choose a leave type.</FieldError>
    </Field>
  ),
};

export const Controlled: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'The value is state the caller owns. Storybook logs `onValueChange` in the Actions panel.',
      },
    },
  },
  render: function ControlledStory(args) {
    const [value, setValue] = useState('annual');
    return (
      <div className="space-y-3">
        <Select
          {...args}
          value={value}
          onValueChange={(next) => {
            setValue(next);
            args.onValueChange?.(next);
          }}
        >
          <SelectTrigger aria-label="Leave type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="annual">Annual leave</SelectItem>
            <SelectItem value="sick">Sick leave</SelectItem>
            <SelectItem value="parental">Parental leave</SelectItem>
          </SelectContent>
        </Select>
        <p className="font-mono text-xs text-fg-muted">value: {value}</p>
      </div>
    );
  },
};

export const Disabled: Story = {
  args: { disabled: true, defaultValue: 'annual' },
  parameters: {
    docs: {
      description: {
        story: 'On the sunken surface, so it reads as inert rather than merely faded.',
      },
    },
  },
  render: (args) => (
    <Select {...args}>
      <SelectTrigger aria-label="Leave type">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="annual">Annual leave</SelectItem>
      </SelectContent>
    </Select>
  ),
};
