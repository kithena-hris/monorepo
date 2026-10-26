'use client';

import { Badge, ToastProvider, useToast } from '@reach/ui';
import { Suspense, use, useEffect, useState, type JSX } from 'react';

import type { InboxPeek } from '../../lib/inbox/peek';
import { t as tr } from '../../lib/t';

/**
 * The Inbox in the sidebar (B1–B3): the count of tasks beside its name (a dot
 * when only updates are unread), and a short toast when a task arrives while
 * the page is open. Both read the Inbox's peek, which the layout passes as a
 * promise so nothing waits for it. Notifications are the Inbox: there is no
 * second list of them anywhere.
 */

const SEEN = 'kithena.inbox.seen';
function seenTasks(): ReadonlySet<string> | null {
  try {
    const raw = sessionStorage.getItem(SEEN);
    return raw === null ? null : new Set(JSON.parse(raw) as string[]);
  } catch {
    return null;
  }
}

function remember(ids: readonly string[]): void {
  try {
    sessionStorage.setItem(SEEN, JSON.stringify(ids));
  } catch {
    // Blocked storage: no toast for new tasks, nothing else lost.
  }
}

/** The count beside the Inbox in the sidebar and on the phone's tab. */
export function InboxCount({
  inbox,
}: {
  readonly inbox: Promise<InboxPeek> | undefined;
}): JSX.Element | null {
  if (inbox === undefined) return null;
  return (
    <Suspense fallback={null}>
      <Count inbox={inbox} />
    </Suspense>
  );
}

function Count({ inbox }: { readonly inbox: Promise<InboxPeek> }): JSX.Element | null {
  const peek = use(inbox);
  return <CountBadge todo={peek.counts.todo} updates={peek.counts.updates} />;
}

/** The red number of tasks, or the dot when only updates are unread. */
function CountBadge({
  todo,
  updates,
}: {
  readonly todo: number;
  readonly updates: number;
}): JSX.Element | null {
  if (todo > 0) {
    return (
      <Badge
        size="xs"
        variant="solid"
        tone="danger"
        aria-label={tr('components.inbox.bell.to_do', '{{todo}} to do', { todo: String(todo) })}
      >
        {todo}
      </Badge>
    );
  }
  return updates > 0 ? (
    <Badge
      size="xs"
      variant="solid"
      tone="accent"
      aria-label={tr('components.inbox.bell.unread_updates', 'Unread updates')}
    />
  ) : null;
}

/** The number for the phone's tab bar, which takes a number rather than a badge. */
export function useInboxTodo(inbox: Promise<InboxPeek> | undefined): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    void inbox?.then((p) => {
      if (live) setN(p.counts.todo);
    });
    return () => {
      live = false;
    };
  }, [inbox]);
  return n;
}

/** B3: a task new since this tab last looked, said once, under its own toast viewport. */
export function InboxToasts({
  inbox,
}: {
  readonly inbox: Promise<InboxPeek> | undefined;
}): JSX.Element | null {
  if (inbox === undefined) return null;
  return (
    <ToastProvider>
      <Suspense fallback={null}>
        <Arrivals inbox={inbox} />
      </Suspense>
    </ToastProvider>
  );
}

function Arrivals({ inbox }: { readonly inbox: Promise<InboxPeek> }): null {
  const peek = use(inbox);
  const { toast } = useToast();
  useEffect(() => {
    const ids = peek.todo.map((t) => t.id);
    const seen = seenTasks();
    remember(ids);
    if (seen === null) return;
    const fresh = peek.todo.find((t) => !seen.has(t.id));
    if (fresh === undefined) return;
    toast({
      title: fresh.title,
      ...(fresh.summary === null ? {} : { description: fresh.summary }),
      tone: 'neutral',
      action: {
        label: tr('components.inbox.bell.open', 'Open'),
        onClick: () => {
          window.location.assign(`/inbox?item=${encodeURIComponent(fresh.id)}`);
        },
      },
    });
  }, [peek, toast]);
  return null;
}
