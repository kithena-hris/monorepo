'use client';

import { Alert, Button, Field, FieldDescription, FieldLabel, Input, Spinner } from '@reach/ui';
import { useCallback, useEffect, useState, type JSX } from 'react';

import { nextSequence, sequenceKey, tokenFromFragment, tokenKey } from '../lib/kiosk';
import { AREAS, remotePath } from '../lib/remotes';
import { RemoteScreen } from './remote-screen';

/**
 * The kiosk at `/kiosk/<id>` (TOF-108): its own full screen, no sidebar and
 * no session, Time Off's `Kiosk` screen drawn from the remote with what this
 * page does for it — keep the device token, ask who tapped, and hand each
 * tap to the service worker's queue (`public/kiosk-sw.js`).
 *
 * The token arrives once, in HR's link (`#token=kk_…`), and lives in the
 * tablet's storage after; without one the page asks for it. Every request is
 * same-origin (`api/[action]/route.ts`), so the worker can hold the punches
 * while the network is down.
 */

type Identified =
  | { readonly status: 'known'; readonly firstName: string; readonly kind: string }
  | { readonly status: 'unknown' }
  | { readonly status: 'offline' };

interface Tap {
  readonly credential: { readonly kind: string; readonly value: string };
  readonly at: string;
}

const read = (key: string): string | null => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string): void => {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // A private window: the kiosk works until it is reloaded.
  }
};

export function KioskShell({ deviceId }: { readonly deviceId: string }): JSX.Element {
  /** `undefined` until the browser has been asked. */
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [typed, setTyped] = useState('');
  const [place, setPlace] = useState<string | null>(null);
  const [refused, setRefused] = useState(false);
  const [online, setOnline] = useState(true);
  const base = `/kiosk/${encodeURIComponent(deviceId)}/api`;

  useEffect(() => {
    const given = tokenFromFragment(window.location.hash);
    if (given !== null) {
      write(tokenKey(deviceId), given);
      // Out of the address, so it is not left in the history or a screenshot.
      window.history.replaceState(null, '', window.location.pathname);
    }
    setToken(given ?? read(tokenKey(deviceId)));
  }, [deviceId]);

  useEffect(() => {
    setOnline(navigator.onLine);
    // Absent on plain http other than localhost: the kiosk then sends at once and keeps nothing.
    const worker = 'serviceWorker' in navigator ? navigator.serviceWorker : null;
    const flush = (): void => {
      worker?.controller?.postMessage('flush');
    };
    const up = (): void => {
      setOnline(true);
      flush();
    };
    const down = (): void => {
      setOnline(false);
    };
    void worker?.register('/kiosk-sw.js', { scope: '/kiosk/' }).catch(() => undefined);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    const every = window.setInterval(flush, 30_000);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
      window.clearInterval(every);
    };
  }, []);

  useEffect(() => {
    if (token === undefined || token === null) return;
    void fetch(`${base}/status`, { headers: { authorization: `Bearer ${token}` } })
      .then(async (answer) => {
        if (answer.status === 401) setRefused(true);
        else if (answer.ok) setPlace(((await answer.json()) as { name: string }).name);
      })
      .catch(() => undefined);
  }, [base, token]);

  const onIdentify = useCallback(
    async (credential: Tap['credential']): Promise<Identified> => {
      const answer = await fetch(`${base}/identify`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token ?? ''}`, 'content-type': 'application/json' },
        body: JSON.stringify({ credential }),
      }).catch(() => null);
      if (answer === null || answer.status >= 500) return { status: 'offline' };
      if (!answer.ok) return { status: 'unknown' };
      const who = (await answer.json()) as { firstName: string; kind: string };
      return { status: 'known', firstName: who.firstName, kind: who.kind };
    },
    [base, token],
  );

  const onPunch = useCallback(
    (tap: Tap): void => {
      const sequence = nextSequence(Number(read(sequenceKey(deviceId)) ?? 0), Date.now());
      write(sequenceKey(deviceId), String(sequence));
      void fetch(`${base}/punches`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token ?? ''}`, 'content-type': 'application/json' },
        body: JSON.stringify({ sentAt: new Date().toISOString(), punches: [{ sequence, ...tap }] }),
      }).catch(() => undefined);
    },
    [base, deviceId, token],
  );

  if (token === undefined) {
    return (
      <main className="grid min-h-dvh place-items-center bg-canvas">
        <Spinner size="lg" label="Starting the kiosk" />
      </main>
    );
  }
  if (token === null || refused) {
    return (
      <main className="grid min-h-dvh place-items-center bg-canvas px-4">
        <form
          className="flex w-full max-w-md flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            const given = typed.trim();
            if (!given.startsWith('kk_')) return;
            write(tokenKey(deviceId), given);
            setRefused(false);
            setToken(given);
          }}
        >
          <h1 className="font-display text-2xl font-bold tracking-tight">Set up this kiosk</h1>
          {refused ? (
            <Alert tone="danger" title="This kiosk’s token no longer works">
              HR may have revoked it. Register the kiosk again in Settings, Time off, Integrations,
              and paste the new token here.
            </Alert>
          ) : null}
          <Field>
            <FieldLabel>Kiosk token</FieldLabel>
            <Input
              value={typed}
              onChange={(event) => {
                setTyped(event.target.value);
              }}
              autoComplete="off"
              spellCheck={false}
            />
            <FieldDescription>
              Shown once to HR when the kiosk was registered. It starts with kk_.
            </FieldDescription>
          </Field>
          <Button type="submit" variant="primary">
            Start the kiosk
          </Button>
        </form>
      </main>
    );
  }

  return (
    <RemoteScreen
      name={AREAS.timeoff.name}
      area={AREAS.timeoff.label}
      route={{ entry: `${remotePath(AREAS.timeoff)}/remoteEntry.js`, component: 'Kiosk' }}
      props={{ place, online, onIdentify, onPunch }}
      fallback={
        <main className="grid min-h-dvh place-items-center bg-canvas">
          <Spinner size="lg" label="Starting the kiosk" />
        </main>
      }
    />
  );
}
