import { Alert, Button, Field, FieldDescription, FieldError, FieldLabel, Input } from '@reach/ui';
import { useCallback, useState, type JSX } from 'react';

import { resolveTenant } from '../../lib/tenant';

/**
 * A fresh setup link for somebody who no longer has their passkey.
 *
 * This replaced a flow that asked them to present the passkey they had just
 * lost — correct as a gate, and useless in the only situation it existed for.
 *
 * **It is weaker than first enrolment, deliberately.** Enrolment requires a
 * second channel: in person, or a value only the person and their HR team know.
 * This is answered with a link to an email address, so whoever holds that
 * mailbox can take the account. `docs/auth-administration.md` sets out why
 * enrolment does not work this way, and `recoverAccount` records what was
 * traded to remove the friction.
 *
 * The answer is the same whatever happens. An address with no account, an
 * address at another company and a suspended account all produce the message
 * below — anything else is a way to ask whether a given person works at a given
 * company, which the sign-in page and the tenant lookup already refuse to say.
 */
type State =
  | { readonly kind: 'idle' }
  | { readonly kind: 'sending' }
  | { readonly kind: 'sent' }
  | { readonly kind: 'stuck' };

/** Shape only. Whether it names an account is deliberately not answered. */
const LOOKS_LIKE_EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export default function Recover(): JSX.Element {
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

    const slug = new URLSearchParams(window.location.search).get('tenant') ?? '';
    const tenant = await resolveTenant(slug);
    if (tenant === null) {
      // The company in the link, not the address. Telling somebody their
      // company could not be found says nothing about who has an account.
      setState({ kind: 'stuck' });
      return;
    }

    const response = await fetch('/api/identity/enrolment/recover', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenantId: tenant.id, workEmail: email.trim() }),
    }).catch(() => null);

    // 202 whatever the outcome. A failure here is the network or the service,
    // not an answer about the address.
    setState(response?.ok === true ? { kind: 'sent' } : { kind: 'stuck' });
  }, [email]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-6">
      <div>
        <h1 className="text-xl font-semibold">Set up a new passkey</h1>
        <p className="text-fg-muted mt-2 text-sm">
          Lost the device, or replaced it? Tell us your work address and we will email you a fresh
          setup link.
        </p>
      </div>

      {state.kind === 'sent' ? (
        <Alert tone="success" title="Check your email">
          If that address has an account, a link is on its way. It works once and expires, so use it
          on the device you want to sign in with from now on.
        </Alert>
      ) : (
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
            <FieldDescription>
              The address your HR team set your account up with.
            </FieldDescription>
            <FieldError>{problem}</FieldError>
          </Field>

          <Button type="submit" variant="primary" disabled={state.kind === 'sending'}>
            {state.kind === 'sending' ? 'Sending…' : 'Email me a setup link'}
          </Button>
        </form>
      )}

      {state.kind === 'stuck' ? (
        <Alert tone="danger" title="That could not be sent">
          Check the link you followed, or ask your HR team to send you a new one.
        </Alert>
      ) : null}
    </main>
  );
}
