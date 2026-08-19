import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';

import { Button } from '../button/button';
import { Card, CardContent, CardHeader, CardTitle } from '../card/card';
import { Stepper } from './stepper';

const steps = [
  { id: 'offer', label: 'Offer', description: 'Accepted 16 Feb' },
  { id: 'checks', label: 'Right to work', description: 'Documents verified' },
  { id: 'contract', label: 'Contract', description: 'Awaiting signature' },
  { id: 'payroll', label: 'Payroll', description: 'Bank details and tax code' },
  { id: 'day-one', label: 'First day', description: 'Equipment and access' },
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
        ].join('\n'),
      },
    },
  },
  argTypes: {
    steps: { control: 'object', table: { category: 'Data' } },
    current: { control: { type: 'range', min: 0, max: 4, step: 1 }, table: { category: 'Data' } },
    orientation: {
      control: 'inline-radio',
      options: ['horizontal', 'vertical'],
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
    current: 2,
    label: 'Onboarding progress',
    onStepChange: fn().mockName('onStepChange(index, step)'),
  },
} satisfies Meta<typeof Stepper>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: (args) => (
    <Card>
      <CardHeader>
        <CardTitle>Onboarding</CardTitle>
      </CardHeader>
      <CardContent>
        <Stepper {...args} />
      </CardContent>
    </Card>
  ),
};

export const Vertical: Story = {
  args: { orientation: 'vertical' },
  parameters: {
    docs: {
      description: {
        story:
          'The orientation for a sidebar, and the one to use once descriptions matter: a horizontal stepper has to truncate them, a vertical one does not. It is also the only shape that survives a narrow screen without wrapping into something unreadable.',
      },
    },
  },
  render: (args) => (
    <Card className="max-w-sm">
      <CardHeader>
        <CardTitle>Onboarding</CardTitle>
      </CardHeader>
      <CardContent>
        <Stepper {...args} />
      </CardContent>
    </Card>
  ),
};

export const WithError: Story = {
  name: 'A step that failed',
  args: {
    current: 3,
    steps: steps.map((step) =>
      step.id === 'checks'
        ? { ...step, status: 'error' as const, description: 'Passport expired, needs a new scan' }
        : step,
    ),
  },
  parameters: {
    docs: {
      description: {
        story:
          'A `status` on the step overrides the one derived from `current`, so a sequence can carry on past something that went wrong. The cross and the danger tone are both there, and the reason sits in the description where it can be read rather than guessed at.',
      },
    },
  },
  render: (args) => (
    <Card>
      <CardHeader>
        <CardTitle>Onboarding</CardTitle>
      </CardHeader>
      <CardContent>
        <Stepper {...args} />
      </CardContent>
    </Card>
  ),
};

export const Wizard: Story = {
  name: 'Driving a wizard',
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
        <CardHeader>
          <CardTitle>New starter</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Stepper
            {...args}
            current={current}
            onStepChange={(index, step) => {
              setCurrent(index);
              args.onStepChange?.(index, step);
            }}
          />
          <div className="rounded-md border border-border bg-surface-sunken/40 p-4 text-sm text-fg-muted">
            {steps[current]?.label}: {steps[current]?.description}
          </div>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              disabled={current === 0}
              onClick={() => {
                setCurrent((value) => value - 1);
              }}
            >
              Back
            </Button>
            <Button
              disabled={current === steps.length - 1}
              onClick={() => {
                setCurrent((value) => value + 1);
              }}
            >
              Continue
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  },
};
