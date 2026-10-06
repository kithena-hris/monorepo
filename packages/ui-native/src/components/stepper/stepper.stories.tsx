import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { Calendar } from 'lucide-react-native';
import { View } from 'react-native-css/components';

import { designDocs, designNote } from '../../docs/design.ts';
import { Button } from '../button/button.tsx';
import { Field, FieldLabel } from '../field/field.tsx';
import { Icon } from '../icon/icon.tsx';
import { Input } from '../input/input.tsx';
import { Text } from '../text/text.tsx';
import { Stepper, StepperDots, StepperProgress } from './stepper.tsx';

const meta = {
  title: 'Components/Stepper',
  component: Stepper,
  parameters: designDocs('stepper'),
  args: { steps: [] },
} satisfies Meta<typeof Stepper>;

export default meta;
type Story = StoryObj<typeof meta>;

const note = (text: string): React.JSX.Element => (
  <Text variant="subhead" tone="muted" className="font-normal leading-[1.5]">
    {text}
  </Text>
);

export const Playground: Story = {
  args: {
    orientation: 'horizontal',
    label: 'Onboarding',
    steps: [
      { label: 'Details', status: 'done' },
      { label: 'Equipment', status: 'current' },
      { label: 'Accounts' },
      { label: 'Review' },
    ],
  },
};

export const Vertical: Story = {
  args: {
    label: 'Onboarding',
    steps: [
      { label: 'Contract signed', status: 'done', description: '2 Sep' },
      { label: 'Laptop shipped', status: 'done', description: '12 Sep' },
      { label: 'Accounts created', status: 'current', description: 'In progress' },
      { label: 'First day', description: '21 Sep' },
    ],
  },
};

export const AStepThatFailed: Story = {
  name: 'A step that failed',
  args: {
    label: 'Onboarding',
    steps: [
      { label: 'Details', status: 'done' },
      { label: 'Right to work', status: 'failed', description: 'Visa expired' },
      { label: 'Accounts' },
    ],
  },
};

function DateField({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <View className="min-w-[140px] flex-1">
      <Field>
        <FieldLabel>{label}</FieldLabel>
        <Input
          defaultValue={value}
          endAdornment={<Icon icon={Calendar} size={18} tone="muted" />}
        />
      </Field>
    </View>
  );
}

export const DrivingAWizard: Story = {
  name: 'Driving a wizard',
  render: () => (
    <View className="gap-4 rounded-[20px] bg-surface p-4">
      <Stepper
        orientation="horizontal"
        label="Request time off"
        steps={[
          { label: 'Type', status: 'done' },
          { label: 'Dates', status: 'current' },
          { label: 'Review' },
        ]}
      />
      <Text variant="title3" weight="bold" accessibilityRole="header">
        When are you off?
      </Text>
      <View className="flex-row flex-wrap items-start gap-2.5">
        <DateField label="From" value="14 Oct" />
        <DateField label="To" value="18 Oct" />
      </View>
      <View className="flex-row justify-between">
        <Button variant="secondary">Back</Button>
        <Button variant="primary">Next</Button>
      </View>
    </View>
  ),
};

export const OnAPhone: Story = {
  name: 'On a phone',
  render: () => (
    <View className="gap-2.5">
      <StepperProgress step={2} count={3} label="Request time off" />
      <Text variant="title2" accessibilityRole="header">
        When are you off?
      </Text>
      {note(
        'On a phone the stepper becomes a progress bar with "2 of 3", so there’s no row of tiny circles.',
      )}
    </View>
  ),
};

export const ClickableCompletedSteps: Story = {
  name: 'Clickable completed steps',
  parameters: designNote('stepper', 'Clickable completed steps'),
  args: {
    label: 'Onboarding',
    steps: [
      { label: 'Details', status: 'done', description: 'Edit', onPress: () => undefined },
      { label: 'Equipment', status: 'done', description: 'Edit', onPress: () => undefined },
      { label: 'Accounts', status: 'current' },
      { label: 'Review' },
    ],
  },
};

export const WithAnOptionalStep: Story = {
  name: 'With an optional step',
  args: {
    label: 'Onboarding',
    steps: [
      { label: 'Contract', status: 'done' },
      { label: 'Equipment', status: 'current', description: 'Optional' },
      { label: 'Review' },
    ],
  },
};

export const Dots: Story = {
  render: () => (
    <View className="items-center gap-2.5">
      <StepperDots count={5} current={2} />
      {note('Dots for short onboarding carousels, where the steps have no names.')}
    </View>
  ),
};
