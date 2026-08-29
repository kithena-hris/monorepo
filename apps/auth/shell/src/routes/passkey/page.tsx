import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { Alert, Button, Spinner } from '@reach/ui';
import { useNavigate } from '@modern-js/runtime/router';
import { useCallback, useState, type JSX } from 'react';

/**
 * Replacing a passkey with a newer one.
 *
 * The gate is the passkey being replaced. There is no link, no code and no
 * email in this flow, and that is deliberate: a link is something a person can
 * be talked into forwarding, and possession of the current passkey is not. It
 * is also what makes this safe to offer from the enrolment page, which anybody
 * holding a spent link can open.
 *
 * Two prompts, in this order, and the order is the whole security of it. The
 * first proves who is asking. The second creates the replacement, against a
 * challenge the server bound to the identity the first one proved — so nothing
 * this page sends can change whose passkey is being replaced.
 *
 * The old passkey stops working. Somebody here has usually lost the device that
 * held it, and leaving it live would make "replace" mean "add".
 */
type State =
  | { readonly kind: 'idle' }
  | { readonly kind: 'proving' }
  | { readonly kind: 'creating' }
  | { readonly kind: 'done' }
  | { readonly kind: 'refused'; readonly reason: 'rejected' | 'cancelled' };

export default function ReplacePasskey(): JSX.Element {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const navigate = useNavigate();

  const replace = useCallback(async () => {
    setState({ kind: 'proving' });

    try {
      const begun = (await post('/api/identity/webauthn/authenticate/begin', {})) as {
        body: { options?: unknown } | null;
      };
      if (!begun.body?.options) {
        setState({ kind: 'refused', reason: 'rejected' });
        return;
      }

      // The first prompt: the passkey being replaced, proving who is asking.
      const assertion = await startAuthentication({
        optionsJSON: begun.body.options as never,
      });

      const gated = (await post('/api/identity/webauthn/replace/begin', {
        origin: window.location.origin,
        response: assertion,
      })) as { ok: boolean; body: { options?: unknown } | null };

      if (!gated.ok || !gated.body?.options) {
        // The assertion did not verify. One refusal, like sign-in: whoever is
        // asking has proved nothing, so there is nothing to tell them.
        setState({ kind: 'refused', reason: 'rejected' });
        return;
      }

      setState({ kind: 'creating' });

      // The second prompt: the replacement itself.
      const attestation = await startRegistration({
        optionsJSON: gated.body.options as never,
      });

      const finished = await post('/api/identity/webauthn/replace/finish', {
        origin: window.location.origin,
        response: attestation,
      });

      if (!finished.ok) {
        setState({ kind: 'refused', reason: 'rejected' });
        return;
      }

      setState({ kind: 'done' });
      // Straight to sign in. The old passkey is revoked by now, so leaving
      // somebody here is leaving them with two prompts behind them and no way
      // forward that they can see.
      window.setTimeout(() => void navigate('/login'), 900);
    } catch {
      // A cancelled prompt throws, and so does a device that refused. Neither
      // is a server decision, and both mean nothing has changed — the current
      // passkey still works, which is the useful thing to say.
      setState({ kind: 'refused', reason: 'cancelled' });
    }
  }, [navigate]);

  const busy = state.kind === 'proving' || state.kind === 'creating';

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-6">
      <div>
        <h1 className="text-xl font-semibold">Replace your passkey</h1>
        <p className="text-fg-muted mt-2 text-sm">
          You will be asked twice: once for the passkey you have now, to prove it is you, and once
          to create the new one. The old passkey stops working straight afterwards.
        </p>
      </div>

      {state.kind === 'refused' ? (
        <Alert
          tone="danger"
          title={
            state.reason === 'cancelled' ? 'Nothing was changed' : 'That could not be verified'
          }
        >
          {state.reason === 'cancelled'
            ? 'Your device did not finish. Your current passkey still works.'
            : 'Use the passkey you set up on this device. If you no longer have it, ask your HR team for a new enrolment link.'}
        </Alert>
      ) : null}

      {state.kind === 'done' ? (
        <Alert tone="success" title="Passkey replaced">
          Taking you to sign in…
        </Alert>
      ) : null}

      {busy ? (
        <Spinner
          label={state.kind === 'proving' ? 'Waiting for your current passkey' : 'Creating the new passkey'}
        />
      ) : null}

      {state.kind === 'done' ? null : (
        <Button variant="primary" onClick={() => void replace()} disabled={busy}>
          {busy ? 'Waiting for your device…' : 'Replace my passkey'}
        </Button>
      )}
    </main>
  );
}

/**
 * Through this origin's proxy, which adds the credential identity requires.
 *
 * The status comes back alongside the body: a refusal here is an empty 401 and
 * `json()` would throw on it.
 */
async function post(path: string, body: unknown): Promise<{ ok: boolean; body: unknown }> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return { ok: response.ok, body: text === '' ? null : JSON.parse(text) };
}
