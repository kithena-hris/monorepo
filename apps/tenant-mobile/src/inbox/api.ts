import { useCallback, useEffect, useState } from 'react';

import type { Signed } from '../people/api';
import { useSigned } from '../people/api';
import type { InboxAnswer, Mute } from './model';

/**
 * The Inbox's own two calls (INB-040): the merged read and the person's state.
 * The read is kept per session in memory, so the tab opens on the last answer
 * at once and asks again behind it; the app reads it ahead at sign-in.
 * Acting on an item is its module's operation (`ask` in `people/api.ts`).
 */

type Answer<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly code: string; readonly message: string };

const kept = new Map<string, { data: InboxAnswer; at: number }>();
const asking = new Map<string, Promise<Answer<InboxAnswer>>>();
const listeners = new Set<() => void>();
const keyOf = (s: Signed): string => `${s.company.origin}\n${s.sessionId}`;

async function call<T>(signed: Signed, path: string, init: RequestInit = {}): Promise<Answer<T>> {
  const response = await fetch(`${signed.company.origin}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${signed.sessionId}`,
    },
  }).catch(() => null);
  if (response === null) {
    return { ok: false, code: 'OFFLINE', message: 'Kithena could not be reached. Try again.' };
  }
  if (response.status === 401) {
    signed.signedOut();
    return { ok: false, code: 'UNAUTHENTICATED', message: 'Sign in again.' };
  }
  const answer = (await response.json().catch(() => null)) as Answer<T> | null;
  return answer ?? { ok: false, code: 'UNAVAILABLE', message: 'Kithena did not answer.' };
}

/** The Inbox, asked once at a time per session; every screen showing it is told. */
export function readInbox(signed: Signed): Promise<Answer<InboxAnswer>> {
  const key = keyOf(signed);
  const held = asking.get(key);
  if (held !== undefined) return held;
  const answer = call<InboxAnswer>(signed, '/api/mobile/inbox').then((a) => {
    if (a.ok) {
      kept.set(key, { data: a.data, at: Date.now() });
      for (const l of listeners) l();
    }
    return a;
  });
  asking.set(key, answer);
  void answer.finally(() => asking.delete(key));
  return answer;
}

export function keptInbox(signed: Signed): InboxAnswer | null {
  return kept.get(keyOf(signed))?.data ?? null;
}

export type Change =
  | { readonly kind: 'read'; readonly ids: readonly string[]; readonly read: boolean }
  | { readonly kind: 'readAll' }
  | { readonly kind: 'snooze'; readonly id: string; readonly until: string | null }
  | { readonly kind: 'done'; readonly ids: readonly string[] }
  | { readonly kind: 'mute'; readonly mute: Mute }
  | { readonly kind: 'unmute'; readonly what: string }
  | { readonly kind: 'tick'; readonly id: string; readonly step: string; readonly on: boolean };

/** Change the person's own state, then read the Inbox again. */
export async function changeInbox(signed: Signed, change: Change): Promise<string | null> {
  const done = await call<null>(signed, '/api/mobile/inbox', {
    method: 'POST',
    body: JSON.stringify(change),
  });
  void readInbox(signed);
  return done.ok ? null : done.message;
}

/** The Inbox for a screen: the last answer at once, asked again on mount and `reload`. */
export function useInbox(): {
  readonly inbox: InboxAnswer | null;
  readonly error: string | null;
  readonly reload: () => void;
} {
  const signed = useSigned();
  const [inbox, setInbox] = useState<InboxAnswer | null>(() => keptInbox(signed));
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    void readInbox(signed).then((a) => {
      if (!a.ok) setError(a.message);
      else setError(null);
    });
  }, [signed]);
  useEffect(() => {
    const told = (): void => {
      setInbox(keptInbox(signed));
    };
    listeners.add(told);
    reload();
    return () => {
      listeners.delete(told);
    };
  }, [signed, reload]);
  return { inbox, error, reload };
}

/** Notification settings (M:I1): read and kept with the account, as the web keeps them. */
export async function readNotifications<T>(signed: Signed): Promise<Answer<T>> {
  return call<T>(signed, '/api/mobile/notifications');
}

export async function saveNotifications(signed: Signed, value: unknown): Promise<string | null> {
  const done = await call<unknown>(signed, '/api/mobile/notifications', {
    method: 'PUT',
    body: JSON.stringify(value),
  });
  return done.ok ? null : done.message;
}
