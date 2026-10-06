import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { Truck, Zap } from 'lucide-react-native';
import { useState, type ReactNode } from 'react';

import { designDocs } from '../../docs/design.ts';
import { Stack } from '../layout/layout.tsx';
import { Text } from '../text/text.tsx';
import { RadioCard, RadioGroup, RadioGroupItem, type RadioGroupProps } from './radio-group.tsx';

const meta = {
  title: 'Forms/RadioGroup',
  component: RadioGroup,
  parameters: designDocs('radio-group'),
} satisfies Meta<typeof RadioGroup>;

export default meta;
// Every story renders its own; no args are shared.
type Story = StoryObj;

function Live({
  initial,
  children,
  ...props
}: Omit<RadioGroupProps, 'value' | 'onValueChange' | 'children'> & {
  initial: string;
  children: ReactNode;
}): React.JSX.Element {
  const [value, setValue] = useState(initial);
  return (
    <RadioGroup value={value} onValueChange={setValue} {...props}>
      {children}
    </RadioGroup>
  );
}

export const Playground: Story = {
  render: () => (
    <Live initial="monthly" accessibilityLabel="Pay schedule">
      <RadioGroupItem value="monthly">Monthly</RadioGroupItem>
      <RadioGroupItem value="fortnightly">Every two weeks</RadioGroupItem>
      <RadioGroupItem value="weekly">Weekly</RadioGroupItem>
    </Live>
  ),
};

export const WithConsequencesSpelledOut: Story = {
  name: 'With consequences spelled out',
  render: () => (
    <Live initial="anonymise" accessibilityLabel="When someone leaves" className="gap-4">
      <RadioGroupItem
        value="keep"
        description="Their profile stays read-only in the directory for 7 years."
      >
        <Text weight="semibold" className="leading-[1.4]">Keep their data</Text>
      </RadioGroupItem>
      <RadioGroupItem
        value="anonymise"
        description="Their name is replaced with an ID. This can’t be undone."
      >
        <Text weight="semibold" className="leading-[1.4]">Anonymise their data</Text>
      </RadioGroupItem>
    </Live>
  ),
};

export const AsCards: Story = {
  name: 'As cards',
  render: () => (
    <Live initial="standard" accessibilityLabel="Delivery" className="gap-2.5">
      <RadioCard value="standard" description="€0 · 5 days" icon={Truck}>
        Standard
      </RadioCard>
      <RadioCard value="express" description="€15 · next day" icon={Zap}>
        Express
      </RadioCard>
    </Live>
  ),
};

export const Horizontal: Story = {
  render: () => (
    <Stack gap={3}>
      <Live initial="none" orientation="horizontal" accessibilityLabel="Title">
        <RadioGroupItem value="mr">Mr</RadioGroupItem>
        <RadioGroupItem value="ms">Ms</RadioGroupItem>
        <RadioGroupItem value="mx">Mx</RadioGroupItem>
        <RadioGroupItem value="none">None</RadioGroupItem>
      </Live>
      <Text variant="subhead" tone="muted">
        On a phone, a horizontal group becomes a segmented control.
      </Text>
    </Stack>
  ),
};

export const ADisabledOption: Story = {
  name: 'A disabled option',
  render: () => (
    <Live initial="bank" accessibilityLabel="Payment method">
      <RadioGroupItem value="bank">Bank transfer</RadioGroupItem>
      <RadioGroupItem value="cheque" disabled description="Not offered in Germany">
        Cheque
      </RadioGroupItem>
      <RadioGroupItem value="cash">Cash</RadioGroupItem>
    </Live>
  ),
};
