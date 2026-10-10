import { useQuery } from '@tanstack/react-query';
import { useCallback } from 'react';

import type { Signed } from '../people/api';
import { useSigned } from '../people/api';
import { queryClient } from '../query';
import type { InboxAnswer, Mute } from './model';

/**
 * The Inbox's own two calls (INB-040): the merged read and the person's state.
 * The read is kept per session in `queryClient`, so the tab opens on the last
 * answer at once and asks again only once it is stale; the app reads it
 * ahead at sign-in.
 * Acting on an item is its module's operation (`ask` in `people/api.ts`).
 */

type Answer<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly code: string; readonly message: string };

const keyOf = (s: Signed): readonly unknown[] => [s.company.origin, s.sessionId, 'inbox'];

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

/** A refusal, thrown so it is never kept as the Inbox. */
class Refused extends Error {}

const inboxQuery = (signed: Signed) => ({
  queryKey: keyOf(signed),
  queryFn: async (): Promise<InboxAnswer> => {
    const a = await call<InboxAnswer>(signed, '/api/mobile/inbox');
    if (!a.ok) throw new Refused(a.message);
    return a.data;
  },
});

/**
 * The Inbox, once at a time per session; every screen showing it is told.
 * Asked now unless the answer kept is younger than `maxAge` ms: a count on
 * a timer takes a recent one, a screen after a write wants what is there now.
 */
export function readInbox(signed: Signed, maxAge = 0): Promise<Answer<InboxAnswer>> {
  return queryClient.query({ ...inboxQuery(signed), staleTime: maxAge }).then(
    (data): Answer<InboxAnswer> => ({ ok: true, data }),
    (error: unknown): Answer<InboxAnswer> => ({
      ok: false,
      code: 'UNAVAILABLE',
      message: error instanceof Error ? error.message : 'Kithena did not answer.',
    }),
  );
}

export function keptInbox(signed: Signed): InboxAnswer | null {
  return queryClient.getQueryData<InboxAnswer>(keyOf(signed)) ?? null;
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

/** The Inbox for a screen: the last answer at once, asked again once stale and on `reload`. */
export function useInbox(): {
  readonly inbox: InboxAnswer | null;
  readonly error: string | null;
  readonly reload: () => void;
} {
  const signed = useSigned();
  const query = useQuery(inboxQuery(signed));
  const { refetch } = query;
  const reload = useCallback(() => {
    void refetch({ cancelRefetch: false });
  }, [refetch]);
  return { inbox: query.data ?? null, error: query.error?.message ?? null, reload };
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

/** An answer about the Inbox (M:Z2): the words, what to open, and a nudge where one is open. */
export interface InboxReply {
  readonly text: string;
  readonly items: readonly {
    readonly id: string;
    readonly title: string;
    readonly hint: string | null;
  }[];
  readonly nudge: { readonly itemId: string; readonly label: string } | null;
}

export async function askInbox(signed: Signed, question: string): Promise<Answer<InboxReply>> {
  return call<InboxReply>(signed, '/api/mobile/inbox/ask', {
    method: 'POST',
    body: JSON.stringify({ question }),
  });
}

/** Whether a question is about the Inbox (the web's `aboutInbox`). */
export const aboutInbox = (question: string): boolean =>
  /\b(inbox|to do|todo|task|tasks|due|this week|waiting|nudge|updates?|my requests)\b/iu.test(
    question,
  );
