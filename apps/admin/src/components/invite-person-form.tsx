'use client';

import {
  Alert,
  Button,
  CopyField,
  Field,
  FieldControl,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
} from '@reach/ui';
import { useActionState, useState, type JSX } from 'react';

import { deliveryNote, type Delivery } from '../lib/delivery';

/**
 * Adding one person to a company that already exists.
 *
 * The whole of HR's day-to-day, and until now there was no way to do it at all:
 * the only route to an enrolment link was creating a whole new tenant, or the
 * seed script.
 *
 * One required field. A start date and a time zone matter — `Account.enrol`
 * refuses a passkey before the start date, which is what stops a hire entered
 * three weeks early logging in during those three weeks — but somebody being
 * added today should not have to think about either, so they sit behind a
 * disclosure and default to today in UTC.
 *
 * `useActionState` with a `FormData` action rather than `onSubmit`: it is the
 * documented shape in this version of Next, and it brings the pending state,
 * the no-JavaScript fallback and the post-submit reset without any of them
 * being written here. The inputs are uncontrolled for the same reason.
 */
export interface Invitation {
  readonly accountId: string;
  readonly email: string;
  readonly enrolUrl: string;
  readonly expiresAt: string;
  readonly employmentStart: string;
  readonly timeZone: string;
  readonly delivery: Delivery;
}

export type InviteResult =
  { ok: true; invitation: Invitation } | { ok: false; message: string; path?: string[] };

export interface InvitePersonFormProps {
  /**
   * A server action. The internal token never reaches this component —
   * `lib/identity` is `server-only`, so importing it here would fail the build
   * rather than quietly bundle a credential into JavaScript anyone can read.
   */
  readonly action: (previous: InviteResult | null, form: FormData) => Promise<InviteResult>;
  readonly companyName: string;
}

export function InvitePersonForm({ action, companyName }: InvitePersonFormProps): JSX.Element {
  const [state, submit, pending] = useActionState(action, null);
  const [showDates, setShowDates] = useState(false);

  const refused = state !== null && !state.ok;
  const domain = companyName.toLowerCase().replaceAll(/[^a-z0-9]+/g, '');

  return (
    <div className="flex flex-col gap-4">
      <form action={submit} className="flex flex-col gap-4">
        <Field invalid={refused} required>
          <FieldLabel>Work email</FieldLabel>
          <FieldControl>
            <Input
              type="email"
              name="email"
              required
              placeholder={`someone@${domain === '' ? 'example' : domain}.com`}
              disabled={pending}
            />
          </FieldControl>
          <FieldDescription>
            They are sent a single-use link and set up a passkey. Nobody signs up on their own.
          </FieldDescription>
          {state !== null && !state.ok ? <FieldError>{state.message}</FieldError> : null}
        </Field>

        {showDates ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel>Start date</FieldLabel>
              <FieldControl>
                <Input type="date" name="employmentStart" disabled={pending} />
              </FieldControl>
              <FieldDescription>
                They cannot set up a passkey before this. Defaults to today.
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel>Time zone</FieldLabel>
              <FieldControl>
                <Input name="timeZone" placeholder="Europe/Madrid" disabled={pending} />
              </FieldControl>
              <FieldDescription>Decides when that date falls. Defaults to UTC.</FieldDescription>
            </Field>
          </div>
        ) : null}

        <div className="flex items-center gap-3">
          <Button type="submit" loading={pending} loadingLabel="Sending the invitation">
            Send invitation
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setShowDates((open) => !open);
            }}
          >
            {showDates ? 'Hide start date' : 'Set a start date'}
          </Button>
        </div>
      </form>

      {state?.ok ? <Sent invitation={state.invitation} /> : null}
    </div>
  );
}

/**
 * What comes back, shown once.
 *
 * The link is here even when the email went out, and that is deliberate rather
 * than redundant: `docs/authentication.md` prefers it handed over in person,
 * because SP 800-63B-4 deprecates email OTP and an emailed link on its own is
 * not an enrolment. An operator standing next to the new hire should use this
 * rather than wait for a mailbox.
 *
 * It cannot be retrieved later. The row holds only the token's hash, so leaving
 * this page is the same as losing the link — and inviting again mints a new one,
 * which invalidates this.
 */
function Sent({ invitation }: { invitation: Invitation }): JSX.Element {
  const note = deliveryNote(invitation.delivery);

  return (
    <Alert tone={note.tone} title={`Invited ${invitation.email}`}>
      <p>{note.text}</p>
      <p className="mt-2">
        The link works once and expires{' '}
        <time dateTime={invitation.expiresAt}>
          {new Date(invitation.expiresAt).toLocaleString('en-GB', {
            day: 'numeric',
            month: 'long',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </time>
        . They can set up their passkey from {invitation.employmentStart}.
      </p>
      <div className="mt-3">
        <CopyField value={invitation.enrolUrl} label="Copy the enrolment link" mono size="sm" />
      </div>
      <p className="text-fg-muted mt-2 text-xs">
        Shown once, and not stored anywhere it can be read back.
      </p>
    </Alert>
  );
}
