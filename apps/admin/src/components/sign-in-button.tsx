'use client';

import { startAuthentication } from '@simplewebauthn/browser';
import { Alert, Button } from '@reach/ui';
import { useRouter } from 'next/navigation';
import { useState, type JSX } from 'react';

export function SignInButton(): JSX.Element {
  const [state, setState] = useState<'idle' | 'working' | 'refused'>('idle');
  const router = useRouter();

  async function signIn(): Promise<void> {
    setState('working');
    try {
      const begun = (await post('/api/operator/begin', {})) as { options?: unknown };
      if (!begun.options) {
        setState('refused');
        return;
      }

      const assertion = await startAuthentication({ optionsJSON: begun.options as never });
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
      <Button onClick={() => void signIn()} disabled={state === 'working'}>
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
