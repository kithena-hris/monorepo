'use client';

import {
  Avatar,
  Badge,
  Button,
  EmptyState,
  KbdShortcut,
  NotificationCenter,
  NotificationGroup,
  NotificationItem,
  SegmentedControl,
  SegmentedControlItem,
  ToastProvider,
  icons,
  useToast,
} from '@reach/ui';
import { Suspense, use, useEffect, useState, type JSX } from 'react';

import type { InboxPeek } from '../../lib/inbox/peek';
import { markAllRead } from '../../app/(app)/inbox/actions';
import { since } from '../since';
import { iconOf } from './format';

/**
 * The bell and the red number (B1–B3): the Inbox's first rows in a peek, so
 * nobody loses their page, and the count of tasks only — updates are a dot,
 * never a number. Both arrive after the page has painted: the layout passes
 * the read as a promise and nothing waits for it.
 *
 * A task that arrives while the page is open shows a short toast under the
 * bell (B3); updates never interrupt.
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
  if (peek.counts.todo > 0) {
    return (
      <Badge
        size="xs"
        variant="solid"
        tone="danger"
        aria-label={`${String(peek.counts.todo)} to do`}
      >
        {peek.counts.todo}
      </Badge>
    );
  }
  return peek.counts.updates > 0 ? (
    <Badge size="xs" variant="solid" tone="accent" aria-label="Unread updates" />
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

function BellButton({
  todo,
  updates,
}: {
  readonly todo: number;
  readonly updates: number;
}): JSX.Element {
  return (
    <Button
      variant="ghost"
      size="sm"
      className="relative"
      aria-label={
        todo === 0
          ? updates === 0
            ? 'Inbox'
            : 'Inbox, unread updates'
          : `Inbox, ${String(todo)} to do`
      }
      startIcon={<icons.notifications aria-hidden />}
    >
      {todo > 0 ? (
        <Badge
          size="xs"
          variant="solid"
          tone="danger"
          aria-hidden
          className="absolute -top-0.5 -end-0.5 ring-2 ring-canvas"
        >
          {todo}
        </Badge>
      ) : updates > 0 ? (
        <Badge
          size="xs"
          variant="solid"
          tone="accent"
          aria-hidden
          className="absolute -top-0.5 -end-0.5 ring-2 ring-canvas"
        />
      ) : null}
    </Button>
  );
}

export function InboxBell({
  inbox,
}: {
  readonly inbox: Promise<InboxPeek> | undefined;
}): JSX.Element {
  return (
    <ToastProvider>
      <Suspense fallback={<BellButton todo={0} updates={0} />}>
        {inbox === undefined ? <BellButton todo={0} updates={0} /> : <Bell inbox={inbox} />}
      </Suspense>
    </ToastProvider>
  );
}

function Bell({ inbox }: { readonly inbox: Promise<InboxPeek> }): JSX.Element {
  const peek = use(inbox);
  const { toast } = useToast();
  const [lane, setLane] = useState<'todo' | 'updates'>('todo');
  const [cleared, setCleared] = useState(false);
  const updates = cleared ? 0 : peek.counts.updates;

  // B3: a task new since this tab last looked, said once.
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
        label: 'Open',
        onClick: () => {
          window.location.assign(`/inbox/todo?item=${encodeURIComponent(fresh.id)}`);
        },
      },
    });
  }, [peek, toast]);

  const rows = lane === 'todo' ? peek.todo : peek.updates;
  return (
    <NotificationCenter
      title="Inbox"
      action={
        <span className="flex items-center gap-1">
          {updates > 0 ? (
            <Button
              variant="ghost"
              size="xs"
              aria-label="Mark all updates read"
              startIcon={<icons.confirm aria-hidden />}
              onClick={() => {
                setCleared(true);
                void markAllRead();
              }}
            />
          ) : null}
          <Button
            asChild
            variant="ghost"
            size="xs"
            aria-label="Notification settings"
            startIcon={<icons.settings aria-hidden />}
          >
            <a href="/settings/notifications" />
          </Button>
        </span>
      }
      trigger={<BellButton todo={peek.counts.todo} updates={updates} />}
    >
      <div className="px-3.5 pt-3 pb-1">
        <SegmentedControl
          aria-label="Show"
          fullWidth
          size="sm"
          value={lane}
          onValueChange={(v) => {
            if (v === 'todo' || v === 'updates') setLane(v);
          }}
        >
          <SegmentedControlItem value="todo">{`To do · ${String(peek.counts.todo)}`}</SegmentedControlItem>
          <SegmentedControlItem value="updates">{`Updates · ${String(updates)}`}</SegmentedControlItem>
        </SegmentedControl>
      </div>
      {rows.length === 0 ? (
        <EmptyState
          icon={lane === 'todo' ? <icons.success /> : <icons.notifications />}
          title={lane === 'todo' ? 'Nothing needs you' : 'No updates'}
          description={
            lane === 'todo' ? 'New tasks appear here.' : 'News from every module lands here.'
          }
        />
      ) : (
        <NotificationGroup aria-label={lane === 'todo' ? 'To do' : 'Updates'}>
          {rows.map((r) => {
            const Icon = iconOf(r.icon);
            return (
              <NotificationItem
                key={r.id}
                title={r.title}
                description={r.summary ?? undefined}
                time={r.count === null ? since(r.at, peek.now) : String(r.count)}
                unread={r.unread && !cleared}
                href={`/inbox/${lane}?item=${encodeURIComponent(r.id)}`}
                {...(lane === 'updates' && r.from?.name != null
                  ? { avatar: <Avatar name={r.from.name} size="lg" /> }
                  : { icon: <Icon aria-hidden />, tone: r.tone ?? 'neutral' })}
              />
            );
          })}
        </NotificationGroup>
      )}
      <div className="flex items-center justify-between border-t border-border px-4 py-2.5">
        <Button asChild variant="link" size="sm">
          <a href={`/inbox/${lane}`}>Open Inbox</a>
        </Button>
        <span className="flex items-center gap-1.5 text-xs text-fg-subtle">
          Go to Inbox <KbdShortcut keys={['G', 'N']} />
        </span>
      </div>
    </NotificationCenter>
  );
}
