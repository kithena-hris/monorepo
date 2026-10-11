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
  FieldControl,
  FieldError,
  FieldLabel,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Stack,
} from '@reach/ui-native';
import { useState } from 'react';
import { View } from 'react-native';

import { useAct } from './act';
import { useRead } from './api';

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
  const [manager, setManager] = useState('');
  // Who may manage them: the first page of People's picker, as the web's combobox opens.
  const picker = useRead<{ options: { value: string; label: string }[] }>('PeoplePicker', {
    search: null,
    after: null,
  }).load;
  const managers = picker.status === 'ready' ? picker.data.options : [];
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
        ...(manager === '' ? [] : [{ key: 'manager_id', text: manager }]),
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
          <DialogDescription>
            Enter what HR owns. They fill in the rest when they accept.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <Stack gap={3}>
            <View className="flex-row gap-2.5">
              <View className="flex-1">
                <Field required invalid={tried && missing.given}>
                  <FieldLabel>First name</FieldLabel>
                  <Input value={given} onChange={setGiven} autoComplete="off" size="sm" />
                  {tried && missing.given ? <FieldError>Enter it.</FieldError> : null}
                </Field>
              </View>
              <View className="flex-1">
                <Field required invalid={tried && missing.family}>
                  <FieldLabel>Family name</FieldLabel>
                  <Input value={family} onChange={setFamily} autoComplete="off" size="sm" />
                  {tried && missing.family ? <FieldError>Enter it.</FieldError> : null}
                </Field>
              </View>
            </View>
            <Field required invalid={tried && missing.email}>
              <FieldLabel>Work email</FieldLabel>
              <Input type="email" value={email} onChange={setEmail} autoComplete="off" size="sm" />
              {tried && missing.email ? (
                <FieldError>Enter the address they will sign in with.</FieldError>
              ) : null}
            </Field>
            <View className="flex-row gap-2.5">
              <View className="flex-1">
                <Field>
                  <FieldLabel>Starts</FieldLabel>
                  <DatePicker
                    label="Starts"
                    placeholder="Optional"
                    value={hireDate}
                    onChange={setHireDate}
                    size="sm"
                  />
                </Field>
              </View>
              {managers.length === 0 ? null : (
                <View className="flex-1">
                  <Field>
                    <FieldLabel>Manager</FieldLabel>
                    <Select value={manager} onValueChange={setManager}>
                      <FieldControl>
                        <SelectTrigger size="sm">
                          <SelectValue placeholder="Optional" />
                        </SelectTrigger>
                      </FieldControl>
                      <SelectContent title="Manager">
                        {managers.map((m) => (
                          <SelectItem key={m.value} value={m.value}>
                            {m.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                </View>
              )}
            </View>
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
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
