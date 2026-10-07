import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { Eye, EyeOff, Search } from 'lucide-react-native';
import { useState } from 'react';

import { designDocs, designNote } from '../../docs/design.ts';
import { Button } from '../button/button.tsx';
import { Card } from '../card/card.tsx';
import { Icon } from '../icon/icon.tsx';
import { Input, Textarea } from '../input/input.tsx';
import { Stack } from '../layout/layout.tsx';
import { Text } from '../text/text.tsx';
import { Field, FieldDescription, FieldError, FieldLabel } from './field.tsx';

const meta = {
  title: 'Forms/Field',
  component: Field,
  parameters: designDocs('field'),
} satisfies Meta<typeof Field>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A text field with its own state, for stories. */
function TextField({
  label,
  initial = '',
  hint,
  error,
  caution,
  placeholder,
  ...props
}: {
  label: string;
  initial?: string;
  hint?: string;
  error?: string;
  caution?: string;
  placeholder?: string;
  disabled?: boolean;
  readOnly?: boolean;
  optional?: boolean;
  startAdornment?: React.ReactNode;
  endAdornment?: React.ReactNode;
}): React.JSX.Element {
  const [value, setValue] = useState(initial);
  return (
    <Field
      invalid={Boolean(error)}
      disabled={props.disabled ?? false}
      optional={props.optional ?? false}
    >
      <FieldLabel>{label}</FieldLabel>
      <Input
        value={value}
        onChange={setValue}
        {...(placeholder ? { placeholder } : {})}
        readOnly={props.readOnly ?? false}
        startAdornment={props.startAdornment}
        endAdornment={props.endAdornment}
      />
      {caution ? <FieldDescription tone="warning">{caution}</FieldDescription> : null}
      {hint ? <FieldDescription>{hint}</FieldDescription> : null}
      {error ? <FieldError>{error}</FieldError> : null}
    </Field>
  );
}

export const Playground: Story = {
  render: () => (
    <TextField label="Preferred name" initial="Priya" hint="This is what colleagues see." />
  ),
};

export const TextStory: Story = {
  name: 'Text',
  render: () => (
    <Stack className="gap-3.5">
      <TextField label="Job title" initial="Senior Engineer" />
      <TextField label="Team" placeholder="e.g. Platform" />
    </Stack>
  ),
};

export const Caution: Story = {
  parameters: designNote('field', 'Caution'),
  render: () => (
    <TextField
      label="Start date"
      initial="1 Jan 2027"
      caution="That’s more than 90 days away. Is that right?"
    />
  ),
};

/** A private value, masked until someone asks to see it. */
function PrivateField({
  label,
  masked,
  shown,
  hint,
  revealed = false,
}: {
  label: string;
  masked: string;
  shown: string;
  hint?: string;
  revealed?: boolean;
}): React.JSX.Element {
  const [visible, setVisible] = useState(revealed);
  const [value, setValue] = useState(shown);
  return (
    <Field sensitive>
      <FieldLabel>{label}</FieldLabel>
      <Input
        // Masked, it shows the mask and ignores typing; revealed, it edits.
        value={visible ? value : masked}
        onChange={visible ? setValue : () => undefined}
        tight
        endAdornment={
          <Button
            variant="ghost"
            size="xs"
            startIcon={<Icon icon={visible ? EyeOff : Eye} size={19} tone="muted" />}
            accessibilityLabel={visible ? `Hide ${label}` : `Show ${label}`}
            onPress={() => {
              setVisible(!visible);
            }}
          />
        }
      />
      {hint ? <FieldDescription>{hint}</FieldDescription> : null}
    </Field>
  );
}

export const Sensitive: Story = {
  render: () => (
    <Stack className="gap-3.5">
      <PrivateField
        label="Date of birth"
        masked="••/••/1991"
        shown="14/03/1991"
        hint="Only you and HR can see this."
      />
      <PrivateField label="Salary" masked="€••,•••" shown="€92,000" revealed />
    </Stack>
  ),
};

export const Missing: Story = {
  render: () => (
    <TextField
      label="Emergency contact"
      placeholder="Name and phone"
      error="Add an emergency contact to finish onboarding."
    />
  ),
};

export const Invalid: Story = {
  render: () => (
    <TextField
      label="Work email"
      initial="priya@reach"
      error="Use a full address, like priya@reach.co."
    />
  ),
};

export const Disabled: Story = {
  render: () => (
    <Stack className="gap-3.5">
      <TextField
        label="Employee ID"
        initial="RCH-00412"
        disabled
        hint="Set by payroll. You can’t change it."
      />
      <TextField
        label="Manager"
        initial="Jonas Weber"
        readOnly
        hint="Read-only: change it in the org chart."
      />
    </Stack>
  ),
};

export const Adornments: Story = {
  render: () => (
    <Stack className="gap-3.5">
      <TextField label="Website" initial="reach.co" startAdornment="https://" />
      <TextField
        label="Search"
        placeholder="Name or email"
        startAdornment={<Icon icon={Search} size={19} tone="muted" />}
      />
      <TextField label="Hourly rate" initial="48.00" startAdornment="€" endAdornment="per hour" />
    </Stack>
  ),
};

export const Horizontal: Story = {
  render: () => (
    <Stack className="gap-3.5">
      <TextField label="First name" initial="Priya" />
      <TextField label="Last name" initial="Shah" />
      <Text variant="subhead" tone="muted">
        Fields always stack on a phone.
      </Text>
    </Stack>
  ),
};

function WholeForm(): React.JSX.Element {
  const [about, setAbout] = useState('');
  return (
    <Card>
      <Stack gap={4}>
        <Text variant="title3" weight="bold">
          Personal details
        </Text>
        <TextField label="First name" initial="Priya" />
        <TextField label="Last name" initial="Shah" />
        <TextField
          label="Work email"
          initial="priya@reach"
          error="Use a full address, like priya@reach.co."
        />
        <TextField label="Phone" initial="151 2345 6789" startAdornment="+49" optional />
        <Field>
          <FieldLabel>About</FieldLabel>
          <Textarea
            value={about}
            onChange={setAbout}
            placeholder="A line or two for your profile"
          />
        </Field>
        <Stack gap={2}>
          <Button variant="primary" fullWidth>
            Save
          </Button>
          <Button fullWidth>Cancel</Button>
        </Stack>
      </Stack>
    </Card>
  );
}

export const AWholeForm: Story = {
  name: 'A whole form',
  render: () => <WholeForm />,
};
