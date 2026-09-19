'use client';

import { startAuthentication } from '@simplewebauthn/browser';
import { Alert, Button } from '@reach/ui';
import { useRouter } from 'next/navigation';
import { useRef, useState, type JSX } from 'react';

/** How long an unused warmed-up challenge is still worth using. */
const WARM_FOR_MS = 60_000;

export function SignInButton(): JSX.Element {
  const [state, setState] = useState<'idle' | 'working' | 'refused'>('idle');
  const router = useRouter();

  /*
   * The challenge, asked for before it is needed.
   *
   * `begin` is a request to this app, which is a request to the identity
   * service, which is a query — three hops on two deployments, and until it
   * came back the browser had not yet been told to show the passkey prompt. So
   * the visible symptom of all that latency was "I clicked and nothing
   * happened", which is the worst place to spend it.
   *
   * Starting on hover or focus moves the wait into the moment somebody is
   * reaching for the button. An unused challenge costs one row that expires on
   * its own, and a stale one is re-requested rather than risked — sixty seconds
   * is well inside any server-side expiry and long enough to cover a reach.
   */
  const warmed = useRef<{ at: number; options: Promise<unknown | null> } | null>(null);

  function warm(): void {
    if (warmed.current !== null && Date.now() - warmed.current.at < WARM_FOR_MS) return;
    warmed.current = {
      at: Date.now(),
      // Swallowed here, retried on click. A failure while nobody has asked for
      // anything yet is not something to put on the screen.
      options: post('/api/operator/begin', {})
        .then((body) => (body as { options?: unknown }).options ?? null)
        .catch(() => null),
    };
  }

  async function signIn(): Promise<void> {
    setState('working');
    try {
      warm();
      let options = await warmed.current?.options;
      // Used once, whatever happens next: a challenge that has been through a
      // ceremony is spent, and one that failed to arrive is worth nothing.
      warmed.current = null;
      options ??= ((await post('/api/operator/begin', {})) as { options?: unknown }).options ?? null;

      if (options === null) {
        setState('refused');
        return;
      }

      const assertion = await startAuthentication({ optionsJSON: options as never });
      const finished = (await post('/api/operator/finish', {
        response: assertion,
        // The challenge the browser signed over, read back out of the assertion
        // so the server can find the ceremony it belongs to.
        challenge: challengeOf(assertion),
      })) as { ok?: boolean };

      if (finished.ok !== true) {
        setState('refused');
        return;
      }
      router.replace('/');
    } catch {
      setState('refused');
    }
  }

  return (
    <>
      <Button
        onClick={() => void signIn()}
        onPointerEnter={warm}
        onFocus={warm}
        disabled={state === 'working'}
      >
        {state === 'working' ? 'Waiting for your device…' : 'Sign in with a passkey'}
      </Button>
      {state === 'refused' ? (
        // One message, as on the product's login page and for the same reason:
        // anybody can reach this, so distinguishing "wrong passkey" from "not
        // an operator" would confirm who runs the back-office.
        <Alert tone="danger" title="That did not work">
          This device does not have a passkey for the back-office.
        </Alert>
      ) : null}
    </>
  );
}

function challengeOf(assertion: { response: { clientDataJSON: string } }): string {
  const decoded = atob(assertion.response.clientDataJSON.replace(/-/g, '+').replace(/_/g, '/'));
  return (JSON.parse(decoded) as { challenge: string }).challenge;
}

async function post(path: string, body: unknown): Promise<unknown> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return response.json();
}
