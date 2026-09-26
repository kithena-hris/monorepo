import {
  Alert,
  Button,
  Card,
  Field,
  FieldControl,
  FieldError,
  FieldLabel,
  Input,
  PageHeader,
  Stack,
} from '@reach/ui';
import { useState, type JSX } from 'react';

/**
 * Add one employee, by hand (HR only).
 *
 * The three facts a record cannot be found, matched or invited without —
 * the core identity fields every published schema has. Everything else is
 * filled in on the new record's profile, which is where HR lands; a whole
 * team at once is the import. People refuses anybody but HR whatever this
 * screen shows.
 */
export interface NewPerson {
  readonly given_name: string;
  readonly family_name: string;
  readonly work_email: string;
}

export type Added = { readonly ok: true } | { readonly ok: false; readonly message: string };

export interface AddPersonProps {
  /** Create the record. On success the host moves on to it. */
  readonly onAdd: (person: NewPerson) => Promise<Added>;
  readonly onCancel?: () => void;
  /** Add a whole team from a file instead. */
  readonly onImport?: () => void;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function AddPerson({ onAdd, onCancel, onImport }: AddPersonProps): JSX.Element {
  const [person, setPerson] = useState<NewPerson>({
    given_name: '',
    family_name: '',
    work_email: '',
  });
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

  return (
    <Stack gap={6}>
      <PageHeader
        title="Add employee"
        description="Their name and work email now; the rest on their record."
        actions={
          onImport === undefined ? undefined : <Button onClick={onImport}>Import a file</Button>
        }
      />
      <Card padded className="max-w-xl">
        <form
          aria-label="Add employee"
          noValidate
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
            }).then((added) => {
              setBusy(false);
              if (!added.ok) setRefused(added.message);
            });
          }}
        >
          <Stack gap={4}>
            <Field required invalid={shown && missing.given_name}>
              <FieldLabel>Legal first name</FieldLabel>
              <FieldControl>
                <Input autoComplete="off" value={person.given_name} onChange={set('given_name')} />
              </FieldControl>
              <FieldError>Enter their first name.</FieldError>
            </Field>
            <Field required invalid={shown && missing.family_name}>
              <FieldLabel>Legal family name</FieldLabel>
              <FieldControl>
                <Input
                  autoComplete="off"
                  value={person.family_name}
                  onChange={set('family_name')}
                />
              </FieldControl>
              <FieldError>Enter their family name.</FieldError>
            </Field>
            <Field required invalid={shown && missing.work_email}>
              <FieldLabel>Work email</FieldLabel>
              <FieldControl>
                <Input
                  type="email"
                  autoComplete="off"
                  value={person.work_email}
                  onChange={set('work_email')}
                />
              </FieldControl>
              <FieldError>Enter a work email, like name@company.com.</FieldError>
            </Field>
            {refused === null ? null : (
              <Alert tone="danger" title="Not added">
                {refused}
              </Alert>
            )}
            <span className="flex gap-2">
              <Button type="submit" variant="primary" loading={busy} loadingLabel="Adding">
                Add employee
              </Button>
              {onCancel === undefined ? null : <Button onClick={onCancel}>Cancel</Button>}
            </span>
          </Stack>
        </form>
      </Card>
    </Stack>
  );
}
