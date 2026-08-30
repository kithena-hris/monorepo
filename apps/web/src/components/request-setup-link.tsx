'use client';

import { Alert, Button, Field, FieldDescription, FieldError, FieldLabel, Input } from '@reach/ui';
import { useCallback, useState, type JSX } from 'react';

/**
 * Asking for a fresh setup link when the passkey is gone.
 *
 * **Weaker than first enrolment, deliberately.** Enrolment requires a second
 * channel — in person, or a value only the person and their HR team know. This
 * is answered with a link to an email address, so whoever holds that mailbox
 * can take the account. `docs/auth-administration.md` sets out why enrolment
 * does not work this way; `recoverAccount` records what was traded to remove
 * the friction of asking somebody to present a passkey they have lost.
 *
 * The answer never varies. An address with no account, an address at another
 * company and a suspended account all produce the same message — anything else
 * is a way to ask whether a given person works at a given company, which the
 * sign-in page and the tenant lookup already refuse to answer.
 */
type State =
  | { readonly kind: 'idle' }
  | { readonly kind: 'sending' }
  | { readonly kind: 'sent' }
  | { readonly kind: 'stuck' };

/** Shape only. Whether it names an account is deliberately not answered. */
const LOOKS_LIKE_EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export function RequestSetupLink(): JSX.Element {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [email, setEmail] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const request = useCallback(async () => {
    if (!LOOKS_LIKE_EMAIL.test(email.trim())) {
      setProblem('Enter the work address your account uses.');
      return;
    }
    setProblem(null);
    setState({ kind: 'sending' });

    const response = await fetch('/api/recover', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // No company in the body. The server takes it from the hostname, which is
      // the only copy of it a client cannot choose.
      body: JSON.stringify({ workEmail: email.trim() }),
    }).catch(() => null);

    // A failure here is the network or the service, never an answer about the
    // address.
    setState(response?.ok === true ? { kind: 'sent' } : { kind: 'stuck' });
  }, [email]);

  if (state.kind === 'sent') {
    return (
      <Alert tone="success" title="Check your email">
        If that address has an account, a link is on its way. It works once and expires, so use it
        on the device you want to sign in with from now on.
      </Alert>
    );
  }

  return (
    <>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void request();
        }}
        className="flex flex-col gap-5"
      >
        <Field invalid={problem !== null}>
          <FieldLabel htmlFor="workEmail">Work email address</FieldLabel>
          <Input
            id="workEmail"
            name="workEmail"
            type="email"
            value={email}
            required
            autoComplete="username"
            disabled={state.kind === 'sending'}
            placeholder="you@yourcompany.com"
            onChange={(event) => {
              setEmail(event.target.value);
              if (problem !== null) setProblem(null);
            }}
          />
          <FieldDescription>The address your HR team set your account up with.</FieldDescription>
          <FieldError>{problem}</FieldError>
        </Field>

        <Button type="submit" variant="primary" disabled={state.kind === 'sending'}>
          {state.kind === 'sending' ? 'Sending…' : 'Email me a setup link'}
        </Button>
      </form>

      {state.kind === 'stuck' ? (
        <Alert tone="danger" title="That could not be sent">
          Try again in a moment, or ask your HR team to send you a new link.
        </Alert>
      ) : null}
    </>
  );
}
