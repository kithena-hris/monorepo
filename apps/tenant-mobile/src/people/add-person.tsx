import {
  Button,
  DatePicker,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldError,
  FieldLabel,
  Input,
  Stack,
} from '@reach/ui-native';
import { useState } from 'react';

import { useAct } from './act';

/** Shape only, as the web's: whether it is free is People's answer. */
const EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

/**
 * Adding a person (design D8): HR enters only what HR owns, the person fills
 * in the rest. Four fields in a centred dialog, the web's `AddPersonDialog`;
 * on success the new record opens.
 */
export function AddPersonDialog({
  open,
  onOpenChange,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: (personId: string, name: string) => void;
}): React.JSX.Element {
  const { act, busy } = useAct();
  const [given, setGiven] = useState('');
  const [family, setFamily] = useState('');
  const [email, setEmail] = useState('');
  const [hireDate, setHireDate] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const missing = {
    given: given.trim() === '',
    family: family.trim() === '',
    email: !EMAIL.test(email.trim()),
  };

  const add = async (): Promise<void> => {
    setTried(true);
    if (missing.given || missing.family || missing.email) return;
    const added = await act<{ id: string }>('CreatePerson', {
      attributes: [
        { key: 'given_name', text: given.trim() },
        { key: 'family_name', text: family.trim() },
        { key: 'work_email', text: email.trim() },
      ],
      hireDate,
    });
    if (added === null) return;
    onOpenChange(false);
    onAdded(added.id, `${given.trim()} ${family.trim()}`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a person</DialogTitle>
          <DialogDescription>HR enters only what HR owns. They fill in the rest.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <Stack gap={3}>
            <Field required invalid={tried && missing.given}>
              <FieldLabel>Legal first name</FieldLabel>
              <Input value={given} onChange={setGiven} autoComplete="off" size="sm" />
              {tried && missing.given ? <FieldError>Enter their first name.</FieldError> : null}
            </Field>
            <Field required invalid={tried && missing.family}>
              <FieldLabel>Legal family name</FieldLabel>
              <Input value={family} onChange={setFamily} autoComplete="off" size="sm" />
              {tried && missing.family ? <FieldError>Enter their family name.</FieldError> : null}
            </Field>
            <Field required invalid={tried && missing.email}>
              <FieldLabel>Work email</FieldLabel>
              <Input type="email" value={email} onChange={setEmail} autoComplete="off" size="sm" />
              {tried && missing.email ? (
                <FieldError>Enter the address they will sign in with.</FieldError>
              ) : null}
            </Field>
            <Field>
              <FieldLabel>Start date</FieldLabel>
              <DatePicker
                label="Start date"
                placeholder="Optional"
                value={hireDate}
                onChange={setHireDate}
                size="sm"
              />
            </Field>
          </Stack>
        </DialogBody>
        <DialogFooter>
          <Button
            className="flex-1"
            onPress={() => {
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <Button
            className="flex-1"
            variant="primary"
            loading={busy === 'CreatePerson'}
            onPress={() => void add()}
          >
            Add employee
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
