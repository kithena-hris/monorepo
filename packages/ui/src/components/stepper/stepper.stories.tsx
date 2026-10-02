import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { CalendarDays } from 'lucide-react';
import { fn } from 'storybook/test';

import { Button } from '../button/button';
import { Card, CardContent } from '../card/card';
import { Field, FieldControl, FieldLabel } from '../field/field';
import { Input } from '../input/input';
import { Stepper, type StepperStep } from './stepper';

const steps: StepperStep[] = [
  { id: 'details', label: 'Details' },
  { id: 'equipment', label: 'Equipment' },
  { id: 'accounts', label: 'Accounts' },
  { id: 'review', label: 'Review' },
];

const meta = {
  title: 'Components/Stepper',
  component: Stepper,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: [
          'Where you are in a sequence that has an end: an onboarding checklist, a payroll run, an approval chain.',
          '',
          '### It is a list, not a progress bar',
          '',
          'A progress bar says "60%". A stepper says **which** step, what came before it and what is still to come, the question someone halfway through actually has. So it is an ordered list with one item per step, and the current one carries `aria-current="step"`.',
          '',
          '### Status is never colour alone',
          '',
          'A completed step has a tick, a failed one a cross, and both say so in text a screen reader reads. *"Completed"*, *"Needs attention"*. Green and red circles are the same circle to around 8% of men, on a projector, and in a printed PDF.',
          '',
          '### Going back is a button; going forward is not',
          '',
          'With `onStepChange`, finished steps become buttons and the ones ahead stay inert. That is not styling: jumping to step 5 from step 2 skips the validation steps 3 and 4 exist to do, and a wizard that can be short-circuited is a wizard that files bad data.',
          '',
          '### On a phone, one label',
          '',
          'Five labels across a phone truncate to a letter each. Under a coarse pointer a horizontal stepper keeps every marker and shows only the current step\'s label, with *"Step 3 of 5"* under it. The other labels stay in the accessibility tree. The pointer decides, not the width.',
        ].join('\n'),
      },
    },
  },
  argTypes: {
    steps: { control: 'object', table: { category: 'Data' } },
    current: { control: { type: 'range', min: 0, max: 3, step: 1 }, table: { category: 'Data' } },
    orientation: {
      control: 'inline-radio',
      options: ['horizontal', 'vertical', 'auto'],
      table: { defaultValue: { summary: "'horizontal'" }, category: 'Appearance' },
    },
    size: {
      control: 'inline-radio',
      options: ['sm', 'md'],
      table: { defaultValue: { summary: "'md'" }, category: 'Appearance' },
    },
    onStepChange: { control: false, table: { category: 'Interaction' } },
  },
  args: {
    steps,
    orientation: 'horizontal',
    current: 1,
    label: 'Onboarding progress',
    onStepChange: fn().mockName('onStepChange(index, step)'),
  },
} satisfies Meta<typeof Stepper>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: (args) => (
    <Card>
      <CardContent className="pt-5">
        <Stepper {...args} />
      </CardContent>
    </Card>
  ),
};

export const Vertical: Story = {
  args: {
    orientation: 'vertical',
    current: 2,
    steps: [
      { id: 'contract', label: 'Contract signed', description: '2 Sep' },
      { id: 'laptop', label: 'Laptop shipped', description: '12 Sep' },
      { id: 'accounts', label: 'Accounts created', description: 'In progress' },
      { id: 'first-day', label: 'First day', description: '21 Sep' },
    ],
  },
  parameters: {
    docs: {
      description: {
        story:
          'The orientation for a sidebar, and the one to use once descriptions matter: a horizontal stepper has to clamp them, a vertical one does not. It stays a list on a phone too.',
      },
    },
  },
  render: (args) => (
    <Card className="max-w-sm">
      <CardContent className="pt-5">
        <Stepper {...args} />
      </CardContent>
    </Card>
  ),
};

export const WithError: Story = {
  name: 'A step that failed',
  args: {
    orientation: 'auto',
    current: 1,
    steps: [
      { id: 'details', label: 'Details' },
      { id: 'right-to-work', label: 'Right to work', status: 'error', description: 'Visa expired' },
      { id: 'accounts', label: 'Accounts' },
    ],
  },
  parameters: {
    docs: {
      description: {
        story:
          'A `status` on the step overrides the one derived from `current`. The cross and the danger tone are both there, and the reason sits in the description where it can be read rather than guessed at. `orientation="auto"` keeps the reason readable on a phone by running the steps down the page.',
      },
    },
  },
  render: (args) => (
    <Card>
      <CardContent className="pt-5">
        <Stepper {...args} />
      </CardContent>
    </Card>
  ),
};

const leaveSteps = [
  { id: 'type', label: 'Type' },
  { id: 'dates', label: 'Dates' },
  { id: 'review', label: 'Review' },
];

export const Wizard: Story = {
  name: 'Driving a wizard',
  args: { steps: leaveSteps, label: 'Requesting time off' },
  parameters: {
    docs: {
      description: {
        story:
          'The stepper reports; the buttons decide. Move forward and the finished steps become clickable: try clicking one, then note that the steps ahead never respond however far you get.',
      },
    },
  },
  render: function WizardStory(args) {
    const [current, setCurrent] = useState(1);

    return (
      <Card>
        <CardContent className="space-y-4 pt-5">
          <Stepper
            {...args}
            current={current}
            onStepChange={(index, step) => {
              setCurrent(index);
              args.onStepChange?.(index, step);
            }}
          />
          <h3 className="font-display text-lg font-bold text-fg">When are you off?</h3>
          <div className="flex flex-wrap gap-2.5">
            <Field className="min-w-35 flex-1">
              <FieldLabel>From</FieldLabel>
              <FieldControl>
                <Input defaultValue="14 Oct" endAdornment={<CalendarDays />} />
              </FieldControl>
            </Field>
            <Field className="min-w-35 flex-1">
              <FieldLabel>To</FieldLabel>
              <FieldControl>
                <Input defaultValue="18 Oct" endAdornment={<CalendarDays />} />
              </FieldControl>
            </Field>
          </div>
          <div className="flex justify-between">
            <Button
              disabled={current === 0}
              onClick={() => {
                setCurrent((value) => value - 1);
              }}
            >
              Back
            </Button>
            <Button
              variant="primary"
              disabled={current === leaveSteps.length - 1}
              onClick={() => {
                setCurrent((value) => value + 1);
              }}
            >
              Next
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  },
};

export const OnAPhone: Story = {
  name: 'On a phone',
  args: { steps: leaveSteps, current: 1, label: 'Requesting time off' },
  parameters: {
    docs: {
      description: {
        story:
          'The same horizontal stepper, under a finger. It becomes a progress bar with "2 of 3", so there is no row of tiny circles with their labels truncated to nothing. The bar is named, and reads out the step it has reached. Compare the two copies beside each other.',
      },
    },
  },
  render: (args) => (
    <div className="max-w-md space-y-2.5">
      <Stepper {...args} />
      <h3 className="font-display text-xl font-bold text-fg">When are you off?</h3>
    </div>
  ),
};
