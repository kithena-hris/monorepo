import { startRegistration } from '@simplewebauthn/browser';
import { useCallback, useState, type JSX } from 'react';
import { Button } from '@reach/ui';

/**
 * Creating a first passkey.
 *
 * A person reaches this with a link their HR team issued and a second channel
 * they satisfied in person — see `docs/authentication.md`, which explains why
 * the link alone is not enough and why SP 800-63B-4 makes that more than a
 * preference. This screen is the last step of that, not the whole of it.
 *
 * The identity id is in the URL here because there is no enrolment landing
 * flow yet. In the finished product the link is exchanged server-side and the
 * browser never sees it.
 */
type State =
  | { readonly kind: 'idle' }
  | { readonly kind: 'working' }
  | { readonly kind: 'done' }
  | { readonly kind: 'refused' };

export default function Enrol(): JSX.Element {
  const [state, setState] = useState<State>({ kind: 'idle' });

  const enrol = useCallback(async () => {
    setState({ kind: 'working' });
    const params = new URLSearchParams(window.location.search);

    try {
      const begun = (await post('/api/identity/webauthn/register/begin', {
        identityId: params.get('identity'),
        displayName: params.get('name') ?? 'Kithena',
      })) as { options?: unknown } | null;
      if (!begun?.options) {
        setState({ kind: 'refused' });
        return;
      }

      const attestation = await startRegistration({ optionsJSON: begun.options as never });

      const finished = (await post('/api/identity/webauthn/register/finish', {
        tenantId: params.get('tenant'),
        token: params.get('token'),
        origin: window.location.origin,
        response: attestation,
      })) as { accountId?: string } | null;

      setState(finished?.accountId === undefined ? { kind: 'refused' } : { kind: 'done' });
    } catch {
      setState({ kind: 'refused' });
    }
  }, []);

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-6">
      <div>
        <h1 className="text-xl font-semibold">Set up your passkey</h1>
        <p className="text-fg-muted mt-1 text-sm">
          Your device will ask for your fingerprint, face or PIN. Nothing leaves it.
        </p>
      </div>

      {/* The design system's button, not a hand-rolled one. Inventing
          `bg-accent text-accent-fg` here produced dark text on an indigo fill —
          `accent-fg` is not a token, so the utility resolved to nothing and the
          contrast gate would have caught it later and less kindly. */}
      <Button onClick={() => void enrol()} disabled={state.kind === 'working'}>
        {state.kind === 'working' ? 'Waiting for your device…' : 'Create a passkey'}
      </Button>

      {state.kind === 'done' ? (
        <p className="text-sm" role="status">
          Done. You can sign in with it now.
        </p>
      ) : null}

      {state.kind === 'refused' ? (
        <p className="text-sm" role="alert">
          That did not work. The link may have been used already, or expired.
        </p>
      ) : null}
    </main>
  );
}

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
