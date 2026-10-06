import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
  NumberField,
  PasswordField,
  PinInput,
  Stack,
  Text,
  Textarea,
} from '@reach/ui-native';
import { useState } from 'react';

/** Lane A's form controls, rendered by Metro on a device. */
export function FormsGallery(): React.JSX.Element {
  const [name, setName] = useState('Priya');
  const [email, setEmail] = useState('priya@reach');
  const [about, setAbout] = useState('');
  const [days, setDays] = useState<number | null>(5);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('48');
  return (
    <Stack className="gap-3.5">
      <Text variant="title3">Forms</Text>
      <Field>
        <FieldLabel>Preferred name</FieldLabel>
        <Input value={name} onChange={setName} />
        <FieldDescription>This is what colleagues see.</FieldDescription>
      </Field>
      <Field invalid>
        <FieldLabel>Work email</FieldLabel>
        <Input type="email" value={email} onChange={setEmail} />
        <FieldError>Use a full address, like priya@reach.co.</FieldError>
      </Field>
      <Field optional>
        <FieldLabel>About</FieldLabel>
        <Textarea value={about} onChange={setAbout} placeholder="A line or two for your profile" />
      </Field>
      <NumberField label="Days" value={days} onChange={setDays} min={0} max={30} />
      <PasswordField
        label="New password"
        autoComplete="new-password"
        value={password}
        onChange={setPassword}
        showStrength
      />
      <PinInput label="Verification code" value={code} onChange={setCode} groupAfter={3} />
    </Stack>
  );
}
