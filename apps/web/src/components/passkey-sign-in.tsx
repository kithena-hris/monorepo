'use client';

import { startAuthentication } from '@simplewebauthn/browser';
import { Alert, Button, Field, FieldDescription, FieldError, FieldLabel, Input } from '@reach/ui';
import { useRouter } from 'next/navigation';
import { useCallback, useState, type JSX } from 'react';

/**
 * Signing in with the passkey on this device, on the company's own origin.
 *
 * Everything the ceremony needs is already here, and that is the point.
 * `docs/authentication.md` records that `app.kithena.com` is a registrable
 * suffix of `acme.app.kithena.com`, so the relying-party id is legal on the
 * tenant hostname: no bounce to a central origin, and the cookie is set by the
 * host it belongs to, which is what `__Host-` requires.
 *
 * The address is asked for, and it is not a username. No `allowCredentials` is
 * sent — a recorded decision in `simplewebauthn-relying-party.ts`, because a
 * per-address credential list is an enumeration oracle for anybody who can type
 * an address. The browser offers whichever passkeys the device holds, exactly as
 * it would without the field.
 *
 * What the address buys is a check the hostname cannot make. The URL says which
 * company; the passkey says which human. Neither says whether the person at the
 * keyboard meant to be *this* person — and on a shared machine holding several
 * passkeys, picking the wrong one silently signs you in as a colleague.
 * Typing the address states the intent, and identity refuses the pair if the
 * verified passkey does not hold an account under it. `chooseAccount` has that
 * rule, and it is applied after verification, so nothing is leaked to somebody
 * who has proved nothing.
 *
 * There is no success state either. Signing in that ends on the page you
 * started on, showing a banner, reports the mechanism and leaves the person
 * where they were. The only visible outcome is their dashboard.
 */
type State =
  { readonly kind: 'idle' } | { readonly kind: 'working' } | { readonly kind: 'refused' };

/** Shape only, and only to save a wasted prompt. Existence is identity's answer. */
const LOOKS_LIKE_EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export function PasskeySignIn(): JSX.Element {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [email, setEmail] = useState('');
  const [emailProblem, setEmailProblem] = useState<string | null>(null);
  const router = useRouter();

  // No event parameter, and no `FormEvent`: this React version deprecates that
  // type, and the handler does not need the event — the caller cancels the
  // navigation and this does the work.
  const signIn = useCallback(async () => {
    if (!LOOKS_LIKE_EMAIL.test(email.trim())) {
      setEmailProblem('Enter the work address you were invited with.');
      return;
    }
    setEmailProblem(null);
    setState({ kind: 'working' });

    try {
      const begun = await fetch('/api/session/challenge', { method: 'POST' });
      if (!begun.ok) {
        setState({ kind: 'refused' });
        return;
      }
      const { options } = (await begun.json()) as { options: unknown };

      // The browser prompt. Everything before this is arrangement; this is the
      // only moment a human is asked for anything.
      const assertion = await startAuthentication({ optionsJSON: options as never });

      const finished = await fetch('/api/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // No tenant in the body. The server takes it from the hostname, which
        // is the only copy of it a client cannot choose. The address is the
        // one thing the hostname cannot supply.
        body: JSON.stringify({ response: assertion, workEmail: email.trim() }),
      });

      if (!finished.ok) {
        setState({ kind: 'refused' });
        return;
      }

      /*
       * `refresh` before `replace`, and both are needed. The cookie was set by
       * a route handler, so the router's cached render of `/` predates it and
       * would paint the signed-out page for a moment. `refresh` discards that;
       * `replace` keeps this page out of history, so Back from the dashboard
       * leaves rather than returning here.
       */
      router.refresh();
      router.replace('/');
    } catch {
      // A cancelled prompt throws, and so does a refusal. They are the same
      // outcome here: nothing happened, try again.
      setState({ kind: 'refused' });
    }
  }, [email, router]);

  const busy = state.kind === 'working';

  return (
    <>
      {/* A real form, so Enter submits and a password manager can fill the
          address without this page implementing a keyboard path of its own. */}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void signIn();
        }}
        className="flex flex-col gap-5"
      >
        <Field invalid={emailProblem !== null}>
          <FieldLabel htmlFor="workEmail">Work email address</FieldLabel>
          <Input
            id="workEmail"
            name="workEmail"
            type="email"
            value={email}
            disabled={busy}
            required
            // `username webauthn` is what lets a password manager offer the
            // right passkey against the right address on a shared device.
            autoComplete="username webauthn"
            placeholder="you@yourcompany.com"
            onChange={(event) => {
              setEmail(event.target.value);
              if (emailProblem !== null) setEmailProblem(null);
            }}
          />
          <FieldDescription>The address your HR team invited you with.</FieldDescription>
          <FieldError>{emailProblem}</FieldError>
        </Field>

        {/* `primary`, not the default. `Button` defaults to `secondary`, a white
            fill with a border — right beside another button, wrong as the only
            action on a sign-in page, where it makes a themed page look unthemed. */}
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? 'Waiting for your device…' : 'Sign in with a passkey'}
        </Button>

        {/* The passkey equivalent of "forgot my password". Placed under the
            button rather than beside the address, because it is the thing you
            reach for after the sign-in did not work, not before trying. */}
        <a
          href="/recover"
          className="text-fg-muted hover:text-fg self-start text-sm underline-offset-2 hover:underline"
        >
          I no longer have my passkey
        </a>
      </form>

      {state.kind === 'refused' ? (
        /*
         * One message for every failure. Anybody can present a passkey here, so
         * distinguishing "wrong passkey" from "no account at this company"
         * would answer a question that is not the asker's to ask. The precise
         * reason is in identity's log, where the person who can act on it looks.
         */
        <Alert tone="danger" title="That did not work">
          Use the passkey you set up for this company. If you have not set one up yet, use the link
          your HR team sent you.
        </Alert>
      ) : null}
    </>
  );
}
