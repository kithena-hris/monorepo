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
  Icon,
  FieldError,
  FieldLabel,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Stack,
  useToast,
} from '@reach/ui-native';
import { Sparkles } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import { useAct } from './act';
import { useRead, useSigned } from './api';
import { readOffer } from './readers';

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
  const signed = useSigned();
  const { toast } = useToast();
  const [reading, setReading] = useState(false);
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
            {/* Or let the signed offer fill them in (v3 P19), each still checked here. */}
            <Button
              variant="tinted"
              fullWidth
              startIcon={<Icon icon={Sparkles} tone="accent" />}
              loading={reading}
              loadingLabel="Reading the offer"
              onPress={() => {
                setReading(true);
                void readOffer(signed).then((read) => {
                  setReading(false);
                  if (read === null) return;
                  if (!read.ok) {
                    toast({
                      title: 'That did not work',
                      description: read.message,
                      tone: 'danger',
                    });
                    return;
                  }
                  const o = read.data;
                  if (o.given !== null) setGiven(o.given);
                  if (o.family !== null) setFamily(o.family);
                  if (o.email !== null) setEmail(o.email);
                  if (o.start !== null) setHireDate(o.start);
                  const boss =
                    o.manager === null
                      ? undefined
                      : managers.find((m) => m.label.toLowerCase() === o.manager?.toLowerCase());
                  if (boss !== undefined) setManager(boss.value);
                  const found = [o.given, o.email, o.start, boss?.value].filter(
                    (x) => x != null,
                  ).length;
                  toast(
                    found === 0
                      ? {
                          title: 'Nothing to fill in',
                          description:
                            'The letter does not say their name, email or start date plainly.',
                          tone: 'warning',
                        }
                      : {
                          title: 'Filled in from the offer',
                          description: 'Check each field before adding.',
                          tone: 'success',
                        },
                  );
                });
              }}
            >
              Fill in from their signed offer
            </Button>
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
