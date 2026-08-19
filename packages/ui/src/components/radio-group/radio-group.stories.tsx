import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { RadioCard, RadioGroup, RadioGroupItem } from './radio-group';

const meta = {
  title: 'Forms/RadioGroup',
  component: RadioGroup,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: [
          'One choice from a small set, with every option visible.',
          '',
          '### Against `Select`',
          '',
          'A radio group shows every option and pays for it in vertical space, so it wins up to about five options and loses badly above ten. It is also the honest control when the options are *not equivalent*: "unpaid leave" and "parental leave" have different consequences, and a collapsed dropdown hides that there was a decision to make.',
          '',
          'A radio group with two options that are opposites is a `Switch`.',
          '',
          '### Keyboard',
          '',
          'The group is one tab stop, and the arrow keys move between options, which also *selects* them. That is the ARIA radio pattern and it is correct, but it means a radio group is a poor place for options with side effects on selection.',
          '',
          '### The card variant',
          '',
          '`RadioCard` makes the whole card the target, which is what makes it work under a thumb, and gives the description room. Use it when the choice deserves weight: a pay schedule, a termination reason, a contract type.',
        ].join('\n'),
      },
    },
  },
  argTypes: {
    value: {
      description: 'Controlled selection. Pair with `onValueChange`.',
      control: false,
      table: { type: { summary: 'string' }, category: 'State' },
    },
    defaultValue: {
      description: 'Uncontrolled starting selection.',
      control: 'text',
      table: { type: { summary: 'string' }, category: 'State' },
    },
    onValueChange: {
      description: 'Fires with the newly selected value.',
      control: false,
      table: { type: { summary: '(value: string) => void' }, category: 'State' },
    },
    name: {
      description: 'Form field name. Set it when the group is inside an uncontrolled `<form>`.',
      control: 'text',
      table: { type: { summary: 'string' }, category: 'Form' },
    },
    required: {
      description: 'Marks the group as required for native form validation.',
      control: 'boolean',
      table: { type: { summary: 'boolean' }, defaultValue: { summary: 'false' }, category: 'Form' },
    },
    disabled: {
      description: 'Disables every option in the group.',
      control: 'boolean',
      table: {
        type: { summary: 'boolean' },
        defaultValue: { summary: 'false' },
        category: 'State',
      },
    },
    orientation: {
      description:
        'Which arrow keys move the selection, and how the group lays out. Horizontal only works for two or three short labels.',
      control: 'inline-radio',
      options: ['vertical', 'horizontal'],
      table: {
        type: { summary: "'vertical' | 'horizontal'" },
        defaultValue: { summary: 'vertical' },
        category: 'Appearance',
      },
    },
    loop: {
      description: 'Whether arrowing past the last option wraps to the first.',
      control: 'boolean',
      table: {
        type: { summary: 'boolean' },
        defaultValue: { summary: 'true' },
        category: 'Behaviour',
      },
    },
    dir: {
      description: 'Text direction. Flips the arrow-key order.',
      control: 'inline-radio',
      options: ['ltr', 'rtl'],
      table: { type: { summary: "'ltr' | 'rtl'" }, category: 'Behaviour' },
    },
    className: {
      control: 'text',
      table: { type: { summary: 'string' }, category: 'Escape hatches' },
    },
  },
  args: {
    defaultValue: 'annual',
    disabled: false,
    orientation: 'vertical',
  },
} satisfies Meta<typeof RadioGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: (args) => (
    <div className="max-w-sm">
      <RadioGroup {...args} aria-label="Leave type">
        <RadioGroupItem value="annual">Annual leave</RadioGroupItem>
        <RadioGroupItem value="sick">Sick leave</RadioGroupItem>
        <RadioGroupItem value="parental">Parental leave</RadioGroupItem>
        <RadioGroupItem value="unpaid">Unpaid leave</RadioGroupItem>
      </RadioGroup>
    </div>
  ),
};

export const WithDescriptions: Story = {
  name: 'With consequences spelled out',
  parameters: {
    docs: {
      description: {
        story:
          'The description is where the option earns its place. "Unpaid leave" and "does not accrue holiday, and reduces this month\'s net pay" are the same choice described at two different levels of honesty.',
      },
    },
  },
  render: (args) => (
    <div className="max-w-md">
      {/* A fieldset with a legend, not a label: a label names one control, and
          a radio group is a set of them. This is the markup an HRIS form should
          be using for every grouped choice. */}
      <fieldset className="min-w-0 border-0 p-0">
        <legend className="text-sm font-medium text-fg">Leave type</legend>
        <p className="mt-0.5 text-xs text-fg-muted">Each type draws from a different balance.</p>
        <RadioGroup {...args} className="mt-2">
          <RadioGroupItem value="annual" description="Draws from your 25-day annual entitlement.">
            Annual leave
          </RadioGroupItem>
          <RadioGroupItem
            value="sick"
            description="Requires a medical certificate after three consecutive days."
          >
            Sick leave
          </RadioGroupItem>
          <RadioGroupItem
            value="parental"
            description="Statutory. Does not reduce your annual entitlement."
          >
            Parental leave
          </RadioGroupItem>
          <RadioGroupItem
            value="unpaid"
            description="Does not accrue holiday, and reduces this month's net pay."
          >
            Unpaid leave
          </RadioGroupItem>
        </RadioGroup>
      </fieldset>
    </div>
  ),
};

export const Cards: Story = {
  name: 'As cards',
  parameters: {
    docs: {
      description: {
        story:
          'The whole card is the label, so the target is the card: comfortably over 44px, which is what makes this the variant to reach for on a phone. The selected card takes the accent wash rather than a border colour alone, because a 1px border change is not a visible state on a bright screen.',
      },
    },
  },
  render: function CardsStory() {
    const [value, setValue] = useState('monthly');
    return (
      <div className="max-w-lg">
        <fieldset className="min-w-0 border-0 p-0">
          <legend className="text-sm font-medium text-fg">Pay schedule</legend>
          <p className="mt-0.5 text-xs text-fg-muted">
            Changing this takes effect from the next unprocessed pay run.
          </p>
          <RadioGroup value={value} onValueChange={setValue} className="mt-2 gap-2">
            <RadioCard
              value="monthly"
              description="Paid on the last working day of each month. The default in Spain and Germany."
            >
              Monthly
            </RadioCard>
            <RadioCard
              value="biweekly"
              description="26 runs a year, every second Friday. Common for hourly contracts."
            >
              Biweekly
            </RadioCard>
            <RadioCard
              value="weekly"
              description="52 runs a year. Increases payroll processing cost per employee."
            >
              Weekly
            </RadioCard>
          </RadioGroup>
        </fieldset>
      </div>
    );
  },
};

export const Horizontal: Story = {
  args: { orientation: 'horizontal', defaultValue: 'yes' },
  parameters: {
    docs: {
      description: {
        story:
          'Only viable for two or three short labels. Beyond that it wraps unpredictably and the arrow keys stop matching what the eye expects.',
      },
    },
  },
  render: (args) => (
    <RadioGroup {...args} aria-label="Eligible for overtime">
      <RadioGroupItem value="yes">Yes</RadioGroupItem>
      <RadioGroupItem value="no">No</RadioGroupItem>
      <RadioGroupItem value="unknown">Not recorded</RadioGroupItem>
    </RadioGroup>
  ),
};

export const DisabledOption: Story = {
  name: 'A disabled option',
  parameters: {
    docs: {
      description: {
        story:
          'The option stays visible with a reason attached. Removing it instead would leave the user wondering whether the feature exists; disabling it without a reason produces the same support ticket a day later.',
      },
    },
  },
  render: (args) => (
    <div className="max-w-md">
      <RadioGroup {...args} aria-label="Contract type" defaultValue="permanent">
        <RadioGroupItem value="permanent" description="Indefinido. No end date.">
          Permanent
        </RadioGroupItem>
        <RadioGroupItem
          value="fixed"
          description="Requires a statutory justification and an end date."
        >
          Fixed term
        </RadioGroupItem>
        <RadioGroupItem
          value="contractor"
          disabled
          description="Not available in this legal entity. Contact People Ops."
        >
          Contractor
        </RadioGroupItem>
      </RadioGroup>
    </div>
  ),
};
