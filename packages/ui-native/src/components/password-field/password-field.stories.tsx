import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { useState } from 'react';

import { ReachMark } from '../../brand/reach-logo.tsx';
import { designDocs } from '../../docs/design.ts';
import { Button } from '../button/button.tsx';
import { Card } from '../card/card.tsx';
import { Field, FieldLabel } from '../field/field.tsx';
import { Input } from '../input/input.tsx';
import { Inline, Stack } from '../layout/layout.tsx';
import { Text } from '../text/text.tsx';
import {
  PasswordField,
  type PasswordFieldProps,
  type PasswordRequirement,
} from './password-field.tsx';

const meta = {
  title: 'Forms/PasswordField',
  component: PasswordField,
  parameters: designDocs('password-field'),
} satisfies Meta<typeof PasswordField>;

export default meta;
// Every story renders its own; no args are shared.
type Story = StoryObj;

function Live({
  initial = '',
  ...props
}: Omit<PasswordFieldProps, 'value' | 'onChange' | 'label' | 'autoComplete'> &
  Partial<Pick<PasswordFieldProps, 'label' | 'autoComplete'>> & {
    initial?: string;
  }): React.JSX.Element {
  const [value, setValue] = useState(initial);
  return (
    <PasswordField
      label="Password"
      autoComplete="current-password"
      value={value}
      onChange={setValue}
      {...props}
    />
  );
}

export const Playground: Story = {
  render: () => <Live initial="Correct-Hor" />,
};

function SignIn(): React.JSX.Element {
  const [email, setEmail] = useState('priya@reach.co');
  return (
    <Card>
      <Stack className="gap-3.5">
        <Inline className="gap-2.5" wrap={false}>
          <ReachMark size={36} />
          <Text variant="title3" weight="bold">
            Sign in to Reach
          </Text>
        </Inline>
        <Field>
          <FieldLabel>Email</FieldLabel>
          <Input type="email" value={email} onChange={setEmail} />
        </Field>
        <Live initial="Correct-Hor" autoFocus />
        <Button variant="link" size="sm" className="self-end">
          Forgot password?
        </Button>
        <Button variant="primary" fullWidth>
          Sign in
        </Button>
      </Stack>
    </Card>
  );
}

export const SigningIn: Story = {
  name: 'Signing in',
  render: () => <SignIn />,
};

const rules: readonly PasswordRequirement[] = [
  { id: 'length', label: 'At least 12 characters', test: (v) => v.length >= 12 },
  { id: 'kind', label: 'A number or symbol', test: (v) => /[\d\W]/.test(v) },
  {
    id: 'common',
    label: 'Not a common password',
    test: (v) => v !== '' && !/^(password|123456|qwerty)/i.test(v),
  },
  { id: 'name', label: 'Not your name or email', test: (v) => v !== '' && !/priya/i.test(v) },
];

export const SettingANewOne: Story = {
  name: 'Setting a new one',
  render: () => (
    <Live
      label="New password"
      autoComplete="new-password"
      initial="Correct-Horse-7"
      defaultRevealed
      showStrength
      requirements={rules}
    />
  ),
};

export const PasteWorks: Story = {
  name: 'Paste works: deliberately',
  render: () => (
    <Stack gap={3}>
      <Live initial="Kx9-vR2m-Tq7w-Lp" autoFocus />
      <Text variant="subhead" tone="muted">
        Pasted from your password manager. We never block paste: blocking it pushes people to
        weaker passwords.
      </Text>
    </Stack>
  ),
};

export const InvalidDisabledSizes: Story = {
  name: 'Invalid, disabled, sizes',
  render: () => (
    <Stack gap={3}>
      <Live initial="Wrong" error="That password isn’t right. 2 tries left." />
      <Live initial="Disabled" disabled />
      <Live initial="Compact1" size="sm" />
    </Stack>
  ),
};
