'use client';

import { startAuthentication } from '@simplewebauthn/browser';
import { Alert, Button } from '@reach/ui';
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
 * There is no email field and no company picker. The hostname already said
 * which company this is, and `(tenant_id, identity_id)` is unique — so the
 * passkey names the person and the URL names the employer, and between them
 * there is exactly one account. Asking for an address as well would be asking
 * somebody to type something the page already knows.
 *
 * There is no success state either. Signing in that ends on the page you
 * started on, showing a banner, reports the mechanism and leaves the person
 * where they were. The only visible outcome is their dashboard.
 */
type State =
  | { readonly kind: 'idle' }
  | { readonly kind: 'working' }
  | { readonly kind: 'refused' };

export function PasskeySignIn(): JSX.Element {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const router = useRouter();

  const signIn = useCallback(async () => {
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
        // is the only copy of it a client cannot choose.
        body: JSON.stringify({ response: assertion }),
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
  }, [router]);

  return (
    <>
      {/* `primary`, not the default. `Button` defaults to `secondary`, a white
          fill with a border — right beside another button, wrong as the only
          action on a sign-in page, where it makes a themed page look unthemed. */}
      <Button variant="primary" onClick={() => void signIn()} disabled={state.kind === 'working'}>
        {state.kind === 'working' ? 'Waiting for your device…' : 'Sign in with a passkey'}
      </Button>

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
