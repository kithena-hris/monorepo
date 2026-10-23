import {
  Alert,
  Button,
  Card,
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
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
  Stack,
  icons,
} from '@reach/ui';
import { useState, type JSX } from 'react';
import { t } from '../i18n';

/**
 * Add one employee, by hand (HR only), in a centred dialog (D9): four
 * fields, one outcome.
 *
 * The three facts a record cannot be found, matched or invited without —
 * the core identity fields every published schema has — and, optionally, the
 * day they start. With a start date People hires them from it (active once it
 * has begun, pre-hire until then); without one the record waits, provisional,
 * for somebody to hire them. Everything else is filled in on the new record's
 * profile, which is where HR lands; a whole team at once is the import.
 * People refuses anybody but HR whatever this screen shows.
 *
 * No job title: it is not a core field, so a tenant may not have one to set.
 */
export interface NewPerson {
  readonly given_name: string;
  readonly family_name: string;
  readonly work_email: string;
  /** A calendar date; absent, they are not hired yet. */
  readonly hireDate?: string;
}

export type Added = { readonly ok: true } | { readonly ok: false; readonly message: string };

export interface AddPersonProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** Create the record. On success the host moves on to it. */
  readonly onAdd: (person: NewPerson) => Promise<Added>;
  /** Add a whole team from a file instead. */
  readonly onImport?: () => void;
  /** Today, as the host knows it, for the start date's calendar to open on. */
  readonly today?: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BLANK: NewPerson = { given_name: '', family_name: '', work_email: '' };

export function AddPersonDialog({
  open,
  onOpenChange,
  onAdd,
  onImport,
  today,
}: AddPersonProps): JSX.Element {
  const [person, setPerson] = useState<NewPerson>(BLANK);
  const [hireDate, setHireDate] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const missing = {
    given_name: person.given_name.trim() === '',
    family_name: person.family_name.trim() === '',
    work_email: !EMAIL.test(person.work_email.trim()),
  };
  const set = (key: keyof NewPerson) => (e: { target: { value: string } }) => {
    setPerson((p) => ({ ...p, [key]: e.target.value }));
  };
  const close = (next: boolean): void => {
    onOpenChange(next);
    if (!next) {
      setPerson(BLANK);
      setHireDate(null);
      setShown(false);
      setRefused(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-190">
        <form
          aria-label={t('onboarding.add-person.add_employee', 'Add employee')}
          noValidate
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            setShown(true);
            if (missing.given_name || missing.family_name || missing.work_email) return;
            setBusy(true);
            setRefused(null);
            void onAdd({
              given_name: person.given_name.trim(),
              family_name: person.family_name.trim(),
              work_email: person.work_email.trim(),
              ...(hireDate === null ? {} : { hireDate }),
            }).then((added) => {
              setBusy(false);
              if (!added.ok) setRefused(added.message);
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('onboarding.add-person.add_a_person', 'Add a person')}</DialogTitle>
            <DialogDescription>
              {t(
                'onboarding.add-person.hr_enters_only_what_hr_owns',
                'HR enters only what HR owns. The person is created, and invited from their record.',
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <div className="grid gap-5 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
              <Stack gap={4}>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field required invalid={shown && missing.given_name}>
                    <FieldLabel>
                      {t('onboarding.add-person.legal_first_name', 'Legal first name')}
                    </FieldLabel>
                    <FieldControl>
                      <Input
                        autoComplete="off"
                        value={person.given_name}
                        onChange={set('given_name')}
                      />
                    </FieldControl>
                    <FieldError>
                      {t('onboarding.add-person.enter_their_first_name', 'Enter their first name.')}
                    </FieldError>
                  </Field>
                  <Field required invalid={shown && missing.family_name}>
                    <FieldLabel>
                      {t('onboarding.add-person.legal_family_name', 'Legal family name')}
                    </FieldLabel>
                    <FieldControl>
                      <Input
                        autoComplete="off"
                        value={person.family_name}
                        onChange={set('family_name')}
                      />
                    </FieldControl>
                    <FieldError>
                      {t(
                        'onboarding.add-person.enter_their_family_name',
                        'Enter their family name.',
                      )}
                    </FieldError>
                  </Field>
                </div>
                <Field required invalid={shown && missing.work_email}>
                  <FieldLabel>{t('onboarding.add-person.work_email', 'Work email')}</FieldLabel>
                  <FieldControl>
                    <Input
                      type="email"
                      autoComplete="off"
                      value={person.work_email}
                      onChange={set('work_email')}
                    />
                  </FieldControl>
                  <FieldError>
                    {t(
                      'onboarding.add-person.enter_a_work_email_like_name',
                      'Enter a work email, like name@company.com.',
                    )}
                  </FieldError>
                </Field>
                <Field>
                  <FieldLabel>{t('onboarding.add-person.start_date', 'Start date')}</FieldLabel>
                  <FieldControl>
                    <DatePicker
                      label={t('onboarding.add-person.start_date', 'Start date')}
                      value={hireDate}
                      onChange={setHireDate}
                      {...(today === undefined ? {} : { today })}
                    />
                  </FieldControl>
                  <FieldDescription>
                    {t(
                      'onboarding.add-person.their_first_day_on_their_own',
                      'Their first day, on their own calendar. Leave empty to add them without hiring them yet.',
                    )}
                  </FieldDescription>
                </Field>
                {refused === null ? null : (
                  <Alert tone="danger" title={t('onboarding.add-person.not_added', 'Not added')}>
                    {refused}
                  </Alert>
                )}
              </Stack>
              <Stack gap={3} className="touch:hidden">
                <Alert
                  tone="info"
                  title={t('onboarding.add-person.they_fill_in_the_rest', 'They fill in the rest')}
                >
                  {t(
                    'onboarding.add-person.personal_details_emergency_contact_and_bank',
                    'Personal details, emergency contact and bank account are asked of them during onboarding.',
                  )}
                </Alert>
                <Card variant="fill" padded>
                  <p className="text-sm font-semibold text-fg">
                    {t('onboarding.add-person.what_happens', 'What happens')}
                  </p>
                  <p className="mt-2 text-sm text-fg-muted">
                    {t(
                      'onboarding.add-person.with_a_start_date_they_are',
                      'With a start date they are pre-hire until then, and an employee from it. Without one, the record waits for somebody to hire them. You land on their record to add what HR owns and send the invitation.',
                    )}
                  </p>
                </Card>
              </Stack>
            </div>
          </DialogBody>
          <DialogFooter>
            {onImport === undefined ? null : (
              <Button
                type="button"
                variant="ghost"
                className="me-auto touch:hidden"
                startIcon={<icons.upload aria-hidden />}
                onClick={onImport}
              >
                {t('onboarding.add-person.import_a_file_instead', 'Import a file instead')}
              </Button>
            )}
            <Button
              type="button"
              onClick={() => {
                close(false);
              }}
            >
              {t('onboarding.add-person.cancel', 'Cancel')}
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={busy}
              loadingLabel={t('onboarding.add-person.adding', 'Adding')}
              shortcut="form.submit"
            >
              {t('onboarding.add-person.add_employee', 'Add employee')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
