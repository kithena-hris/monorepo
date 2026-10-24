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
  Icon,
  FieldError,
  FieldLabel,
  Input,
  Stack,
  useToast,
} from '@reach/ui-native';
import { Sparkles } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import { useAct } from './act';
import { ask, useSigned } from './api';
import { PersonPicker } from './attribute-input';
import { readOffer } from './readers';
import { t } from '../i18n';

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
  // Who the offer named, so the picker says their name before anyone searches.
  const [named, setNamed] = useState<readonly { value: string; label: string }[]>([]);
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
          <DialogTitle>{t('people.add-person.add_a_person', 'Add a person')}</DialogTitle>
          <DialogDescription>
            {t(
              'people.add-person.enter_what_hr_owns_they_fill',
              'Enter what HR owns. They fill in the rest when they accept.',
            )}
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
              loadingLabel={t('people.add-person.reading_the_offer', 'Reading the offer')}
              onPress={() => {
                setReading(true);
                void readOffer(signed).then(async (read) => {
                  if (read === null) {
                    setReading(false);
                    return;
                  }
                  if (!read.ok) {
                    setReading(false);
                    toast({
                      title: t('people.add-person.that_did_not_work', 'That did not work'),
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
                  // Searched over everybody, and taken only when one person has that name.
                  const said = o.manager?.trim().toLowerCase() ?? '';
                  const found =
                    said === ''
                      ? null
                      : await ask<{ options: { value: string; label: string }[] }>(
                          signed,
                          'PeoplePicker',
                          { search: said.slice(0, 200) },
                        );
                  const same = found?.ok
                    ? found.data.options.filter((m) => m.label.toLowerCase() === said)
                    : [];
                  const boss = same.length === 1 ? same[0] : undefined;
                  if (boss !== undefined) {
                    setNamed([boss]);
                    setManager(boss.value);
                  }
                  setReading(false);
                  const filled = [o.given, o.email, o.start, boss?.value].filter(
                    (x) => x != null,
                  ).length;
                  toast(
                    filled === 0
                      ? {
                          title: t('people.add-person.nothing_to_fill_in', 'Nothing to fill in'),
                          description: t(
                            'people.add-person.the_letter_does_not_say_their',
                            'The letter does not say their name, email or start date plainly.',
                          ),
                          tone: 'warning',
                        }
                      : {
                          title: t(
                            'people.add-person.filled_in_from_the_offer',
                            'Filled in from the offer',
                          ),
                          description: t(
                            'people.add-person.check_each_field_before_adding',
                            'Check each field before adding.',
                          ),
                          tone: 'success',
                        },
                  );
                });
              }}
            >
              {t(
                'people.add-person.fill_in_from_their_signed_offer',
                'Fill in from their signed offer',
              )}
            </Button>
            <View className="flex-row gap-2.5">
              <View className="flex-1">
                <Field required invalid={tried && missing.given}>
                  <FieldLabel>{t('people.add-person.first_name', 'First name')}</FieldLabel>
                  <Input value={given} onChange={setGiven} autoComplete="off" size="sm" />
                  {tried && missing.given ? (
                    <FieldError>{t('people.add-person.enter_it', 'Enter it.')}</FieldError>
                  ) : null}
                </Field>
              </View>
              <View className="flex-1">
                <Field required invalid={tried && missing.family}>
                  <FieldLabel>{t('people.add-person.family_name', 'Family name')}</FieldLabel>
                  <Input value={family} onChange={setFamily} autoComplete="off" size="sm" />
                  {tried && missing.family ? (
                    <FieldError>{t('people.add-person.enter_it', 'Enter it.')}</FieldError>
                  ) : null}
                </Field>
              </View>
            </View>
            <Field required invalid={tried && missing.email}>
              <FieldLabel>{t('people.add-person.work_email', 'Work email')}</FieldLabel>
              <Input type="email" value={email} onChange={setEmail} autoComplete="off" size="sm" />
              {tried && missing.email ? (
                <FieldError>
                  {t(
                    'people.add-person.enter_the_address_they_will_sign',
                    'Enter the address they will sign in with.',
                  )}
                </FieldError>
              ) : null}
            </Field>
            <View className="flex-row gap-2.5">
              <View className="flex-1">
                <Field>
                  <FieldLabel>{t('people.add-person.starts', 'Starts')}</FieldLabel>
                  <DatePicker
                    label={t('people.add-person.starts', 'Starts')}
                    placeholder={t('people.add-person.optional', 'Optional')}
                    value={hireDate}
                    onChange={setHireDate}
                    size="sm"
                  />
                </Field>
              </View>
              <View className="flex-1">
                <Field>
                  <FieldLabel>{t('people.add-person.manager', 'Manager')}</FieldLabel>
                  {/* Searched over everybody, a title and department under each name (PEO-122). */}
                  <PersonPicker
                    label={t('people.add-person.manager', 'Manager')}
                    known={named}
                    value={manager}
                    onChange={(id) => {
                      setManager(id ?? '');
                    }}
                    disabled={false}
                    placeholder={t('people.add-person.optional', 'Optional')}
                    size="sm"
                  />
                </Field>
              </View>
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
            {t('people.add-person.cancel', 'Cancel')}
          </Button>
          <Button
            className="flex-1"
            variant="primary"
            loading={busy === 'CreatePerson'}
            onPress={() => void add()}
          >
            {t('people.add-person.add', 'Add')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
