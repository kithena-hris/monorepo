import { startAuthentication } from '@simplewebauthn/browser';
import { useCallback, useState, type JSX } from 'react';
import { Alert, Button } from '@reach/ui';

import { resolveTenant } from '../../lib/tenant';

/**
 * Signing in with a passkey.
 *
 * Rendered on the server and made interactive on the client, because the
 * ceremony needs `navigator.credentials` and the shell around it does not.
 *
 * The tenant arrives in the query string. In the finished product it arrives in
 * the hostname instead — `acme.app.kithena.com` — and this screen is served
 * from there, which is what removes the redirect from the common path. Until
 * the tenant app exists, the auth origin holds it and the tenant is explicit.
 */
type State =
  | { readonly kind: 'idle' }
  | { readonly kind: 'working' }
  | { readonly kind: 'signed-in'; readonly accountId: string }
  | { readonly kind: 'refused' };

export default function Login(): JSX.Element {
  const [state, setState] = useState<State>({ kind: 'idle' });

  const signIn = useCallback(async () => {
    setState({ kind: 'working' });

    // The company's name, not its id. Resolved through the registry, so a
    // reserved label or a suspended customer is refused here rather than
    // producing a lookup that quietly finds nothing later.
    const tenant = await resolveTenant(
      new URLSearchParams(window.location.search).get('tenant') ?? '',
    );
    if (tenant === null) {
      setState({ kind: 'refused' });
      return;
    }

    try {
      const begun = (await post('/api/identity/webauthn/authenticate/begin', {})) as {
        options?: unknown;
      };
      if (!begun.options) {
        setState({ kind: 'refused' });
        return;
      }

      // The browser prompt. Everything before this is arrangement; this is the
      // only moment a human is asked for anything.
      const assertion = await startAuthentication({ optionsJSON: begun.options as never });

      const finished = (await post('/api/identity/webauthn/authenticate/finish', {
        tenantId: tenant.id,
        origin: window.location.origin,
        response: assertion,
        // No address. A browser cannot see its own, and inventing a
        // placeholder is what put the literal 'unknown' into an `inet` column.
        // Whatever terminates the connection supplies it, or nothing does.
        device: { userAgent: navigator.userAgent },
      })) as { accountId?: string } | null;

      setState(
        finished?.accountId === undefined
          ? { kind: 'refused' }
          : { kind: 'signed-in', accountId: finished.accountId },
      );
    } catch {
      // A cancelled prompt throws, and so does a refusal. They are the same
      // outcome to this screen: nothing happened, try again.
      setState({ kind: 'refused' });
    }
  }, []);

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-6">
      <div>
        <h1 className="text-xl font-semibold">Sign in</h1>
        <p className="text-fg-muted mt-1 text-sm">
          Use the passkey on this device. There is no password to remember.
        </p>
      </div>

      {/* The design system's button, not a hand-rolled one. Inventing
          `bg-accent text-accent-fg` here produced dark text on an indigo fill —
          `accent-fg` is not a token, so the utility resolved to nothing and the
          contrast gate would have caught it later and less kindly. */}
      <Button onClick={() => void signIn()} disabled={state.kind === 'working'}>
        {state.kind === 'working' ? 'Waiting for your device…' : 'Sign in with a passkey'}
      </Button>

      {state.kind === 'signed-in' ? (
        <Alert tone="success" title="Signed in">
          Account <code>{state.accountId}</code>.
        </Alert>
      ) : null}

      {state.kind === 'refused' ? (
        /*
         * One message for every failure, unlike enrolment.
         *
         * Anyone can present a passkey here, so distinguishing "wrong passkey"
         * from "no account at this company" would answer a question that is not
         * the asker's to ask. The precise reason is in the identity service's
         * log, where the person who can act on it will look.
         */
        <Alert tone="danger" title="That did not work">
          Check you are signing in to the right company, or ask your HR team for a new enrolment
          link.
        </Alert>
      ) : null}
    </main>
  );
}

/**
 * Through this origin's proxy, which adds the credential identity requires.
 *
 * A refusal is an empty 401, so `json()` would throw on it. Returning null
 * keeps every failure the same shape as every other failure.
 */
async function post(path: string, body: unknown): Promise<unknown> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) return null;
  const text = await response.text();
  return text === '' ? null : JSON.parse(text);
}
