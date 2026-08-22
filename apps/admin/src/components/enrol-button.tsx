'use client';

import { startRegistration } from '@simplewebauthn/browser';
import { Alert, Button } from '@reach/ui';
import { useRouter } from 'next/navigation';
import { useState, type JSX } from 'react';

type State = 'idle' | 'working' | 'done' | 'refused';

export function EnrolButton({ identityId }: { identityId: string | null }): JSX.Element {
  const [state, setState] = useState<State>('idle');
  const router = useRouter();

  if (identityId === null) {
    return (
      <Alert tone="danger" title="Nothing to enrol">
        This link is missing the operator it belongs to.
      </Alert>
    );
  }

  async function enrol(): Promise<void> {
    setState('working');
    try {
      const begun = (await post({ step: 'begin', identityId })) as { options?: unknown };
      if (!begun.options) {
        setState('refused');
        return;
      }

      const attestation = await startRegistration({ optionsJSON: begun.options as never });
      const finished = (await post({
        step: 'finish',
        response: attestation,
        challenge: challengeOf(attestation),
      })) as { enrolled?: boolean };

      if (finished.enrolled !== true) {
        setState('refused');
        return;
      }

      setState('done');
      // Enrolling makes the operator active, so the next thing they need is the
      // sign-in they can now complete. Leaving somebody on a success screen is
      // how they press the button again on a ceremony that is finished.
      window.setTimeout(() => {
        router.replace('/sign-in');
      }, 900);
    } catch {
      setState('refused');
    }
  }

  return (
    <>
      {state === 'done' ? (
        <Alert tone="success" title="Passkey created">
          Taking you to sign in…
        </Alert>
      ) : (
        <Button onClick={() => void enrol()} disabled={state === 'working'}>
          {state === 'working' ? 'Waiting for your device…' : 'Create a passkey'}
        </Button>
      )}

      {state === 'refused' ? (
        <Alert tone="danger" title="That did not work">
          This operator may already have a passkey, or the link may name somebody who is not
          expecting one.
        </Alert>
      ) : null}
    </>
  );
}

function challengeOf(attestation: { response: { clientDataJSON: string } }): string {
  const decoded = atob(attestation.response.clientDataJSON.replace(/-/g, '+').replace(/_/g, '/'));
  return (JSON.parse(decoded) as { challenge: string }).challenge;
}

async function post(body: unknown): Promise<unknown> {
  const response = await fetch('/api/operator/enrol', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return response.json();
}
