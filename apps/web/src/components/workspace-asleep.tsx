'use client';

import { Alert, Button, Spinner } from '@reach/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type JSX } from 'react';

/**
 * What the People area shows while the VM behind it is asleep
 * (`deploy/vm/idle-stop.sh`), and what wakes it.
 *
 * Mounted by the People page only when the router could not be reached and
 * waking is configured (`lib/workspace.ts`). It asks for one start, then polls
 * until EC2 says running and the router answers through the tunnel, and asks
 * the server for the page again. Nothing here decides who may wake it: the
 * route does.
 */

const POLL_MS = 5_000;
const GIVE_UP_MS = 5 * 60_000;

type Phase = 'starting' | 'failed';

async function ask(method: 'GET' | 'POST'): Promise<{ ok: boolean; ready?: boolean }> {
  try {
    const response = await fetch('/api/workspace', { method, cache: 'no-store' });
    if (!response.ok) return { ok: false };
    return (await response.json()) as { ok: boolean; ready?: boolean };
  } catch {
    return { ok: false };
  }
}

export function WorkspaceAsleep({ pollMs = POLL_MS }: { readonly pollMs?: number }): JSX.Element {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('starting');
  // Bumped by "Try again", which runs the whole wake from the start.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (phase !== 'starting') return undefined;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const began = Date.now();

    const poll = async (): Promise<void> => {
      const status = await ask('GET');
      if (stopped) return;
      if (status.ready === true) {
        router.refresh();
        return;
      }
      if (Date.now() - began > GIVE_UP_MS) {
        setPhase('failed');
        return;
      }
      timer = setTimeout(() => void poll(), pollMs);
    };

    void ask('POST').then((woke) => {
      if (stopped) return;
      if (!woke.ok) {
        setPhase('failed');
        return;
      }
      if (woke.ready === true) router.refresh();
      else timer = setTimeout(() => void poll(), pollMs);
    });

    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [phase, attempt, pollMs, router]);

  if (phase === 'failed') {
    return (
      <Alert
        tone="warning"
        title="Your workspace did not start"
        action={
          <Button
            variant="secondary"
            onClick={() => {
              setAttempt((n) => n + 1);
              setPhase('starting');
            }}
          >
            Try again
          </Button>
        }
      >
        It is still asleep. Try again, and if it stays asleep, ask whoever runs your Kithena
        workspace.
      </Alert>
    );
  }

  return (
    <Alert title="Your workspace is asleep" hideIcon>
      <span className="inline-flex items-center gap-2">
        {/* The alert announces the words; the spinner is only the picture. */}
        <Spinner size="sm" aria-hidden="true" />
        Starting… (usually about 90 s)
      </span>
    </Alert>
  );
}
