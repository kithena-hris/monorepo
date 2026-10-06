import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { Smartphone } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native-css/components';

import { designDocs } from '../../docs/design.ts';
import { Card } from '../card/card.tsx';
import { Icon } from '../icon/icon.tsx';
import { Stack } from '../layout/layout.tsx';
import { Text } from '../text/text.tsx';
import { PinInput, type PinInputProps } from './pin-input.tsx';

const meta = {
  title: 'Forms/PinInput',
  component: PinInput,
  parameters: designDocs('pin-input'),
} satisfies Meta<typeof PinInput>;

export default meta;
// Every story renders its own; no args are shared.
type Story = StoryObj;

function Live({
  initial = '',
  ...props
}: Omit<PinInputProps, 'value' | 'onChange' | 'label'> & {
  initial?: string;
  label?: string;
}): React.JSX.Element {
  const [value, setValue] = useState(initial);
  return <PinInput label="Verification code" value={value} onChange={setValue} {...props} />;
}

export const Playground: Story = {
  render: () => <Live initial="48" autoFocus />,
};

export const PastingACode: Story = {
  name: 'Pasting a code',
  render: () => (
    <Stack gap={3}>
      <Live initial="482917" />
      <Text variant="subhead" tone="muted">
        Pasted 482917. All six boxes filled, and the form submitted.
      </Text>
    </Stack>
  ),
};

export const AVerificationScreen: Story = {
  name: 'A verification screen',
  render: () => (
    <Card>
      <Stack gap={3} align="center">
        <View className="size-12 items-center justify-center rounded-full bg-accent-subtle">
          <Icon icon={Smartphone} size={22} tone="accent" />
        </View>
        <Text variant="title2">Check your phone</Text>
        <Text variant="subhead" tone="muted" className="text-center">
          We sent a 6-digit code to +49 ••• ••• 6789.
        </Text>
        <Live initial="482" groupAfter={3} autoFocus />
        <Text variant="subhead" tone="muted" weight="medium">
          Resend in 0:24
        </Text>
      </Stack>
    </Card>
  ),
};

export const LengthsGroupsAndLetters: Story = {
  name: 'Lengths, groups and letters',
  render: () => (
    <Stack className="gap-3.5">
      <Live initial="1234" length={4} label="PIN" />
      <Live initial="482917" groupAfter={3} />
      <Live initial="K7X2" length={4} type="alphanumeric" label="Room code" />
      <Text variant="subhead" tone="muted">
        Letters are shown in capitals and matched without case.
      </Text>
    </Stack>
  ),
};

export const AStoredPin: Story = {
  name: 'A stored PIN',
  render: () => (
    <Stack gap={3}>
      <Live initial="1234" length={4} masked label="PIN" />
      <Live
        length={4}
        masked
        invalid
        label="PIN"
        hint="Wrong PIN. 2 tries left before it locks for 5 minutes."
      />
      <Live initial="1234" length={4} disabled label="PIN" />
    </Stack>
  ),
};
