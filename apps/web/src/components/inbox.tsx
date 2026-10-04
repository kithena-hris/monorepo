'use client';

import {
  Avatar,
  Badge,
  Button,
  EmptyState,
  NotificationCenter,
  NotificationGroup,
  NotificationItem,
  PageHeader,
  PageSection,
  SegmentedControl,
  SegmentedControlItem,
  icons,
} from '@reach/ui';
import Link from 'next/link';
import { useState, type JSX, type ReactNode } from 'react';

import {
  flaggedInboxRows,
  todoRows,
  type InboxRow,
  type InboxView,
} from '../lib/inbox';
import { viewedAsNotice, type ShellData } from '../lib/shell-data';
import { AccountSheet, type AppShellProps } from './app-shell';
import { InboxViews } from './inbox-views';
import { since } from './since';
import { Waking } from './waking';

/**
 * The Inbox (design B3, MA B3): one inbox with three views, the same rows on
 * the desk's bell and the phone's Inbox tab. To do is what waits for this
 * person; Flagged (whoever decides) the changes People's checks flagged, each
 * with its reason on the row; Updates every time a People administrator viewed
 * Kithena as them. Every row opens its item where it is done, a decision in
 * Review.
 */

/** Each kind's glyph, beside a row nobody's face stands for. */
const KIND: Readonly<Record<InboxRow['kind'], ReactNode>> = {
  change: <icons.edit aria-hidden />,
  id: <icons.identifier aria-hidden />,
  duplicate: <icons.merge aria-hidden />,
  access: <icons.sensitive aria-hidden />,
  missing: <icons.person aria-hidden />,
  import: <icons.upload aria-hidden />,
  viewed: <icons.visible aria-hidden />,
};

/** The rows, each its face or its kind, what it is, how long ago and why it stands out. */
export function InboxRows({
  rows,
  now,
  label,
}: {
  readonly rows: readonly InboxRow[];
  readonly now: string | null;
  readonly label: string;
}): JSX.Element {
  return (
    <NotificationGroup aria-label={label}>
      {rows.map((r) => (
        <NotificationItem
          key={r.id}
          title={r.name}
          description={r.summary}
          {...(r.flag === undefined ? {} : { note: r.flag })}
          time={r.at === null || now === null ? '' : since(r.at, now)}
          href={r.href}
          {...(r.person
            ? { avatar: <Avatar name={r.name} size="lg" /> }
            : {
                icon: KIND[r.kind],
                tone:
                  r.kind === 'import'
                    ? r.failed === true
                      ? ('danger' as const)
                      : ('success' as const)
                    : ('warning' as const),
              })}
        />
      ))}
    </NotificationGroup>
  );
}

/** Being viewed as, kept here after the bell has moved on: the entry they can always come back to. */
function Updates({ shell }: { readonly shell: ShellData }): JSX.Element {
  if (shell.viewedAs.length === 0) {
    return (
      <EmptyState
        icon={<icons.notifications />}
        title="No updates"
        description="When something happens to your record, you hear about it here."
      />
    );
  }
  return (
    <PageSection title="Viewed as you" description="When a People administrator saw Kithena as you, read-only.">
      <ul className="flex flex-col gap-2">
        {shell.viewedAs.map((v) => {
          const said = viewedAsNotice(v);
          return (
            <NotificationItem
              key={v.id}
              title={said.title}
              description={said.detail}
              time={shell.now === null ? '' : since(v.endedAt, shell.now)}
              avatar={<Avatar name={v.by ?? 'People administrator'} size="lg" />}
            />
          );
        })}
      </ul>
    </PageSection>
  );
}

const NOTHING_TO_DO = (
  <EmptyState
    icon={<icons.inbox />}
    title="Nothing to do"
    description="Approvals and details you are asked for land here."
  />
);

const NOTHING_FLAGGED = (
  <EmptyState
    icon={<icons.flagged />}
    title="Nothing flagged"
    description="No change waiting for you looks unusual."
  />
);

/**
 * The bell (B3): the Inbox as a popover at a desk, drawn from the shell's
 * data. Its view is the popover's own, held while it is open.
 */
export function InboxBell({ shell }: { readonly shell: ShellData }): JSX.Element {
  const todo = todoRows(shell);
  const count = todo.length;
  const decides = shell.roles.hr;
  const [view, setView] = useState<InboxView>('todo');
  const flagged = shell.flagged ?? null;
  return (
    <NotificationCenter
      title="Inbox"
      trigger={
        <Button
          variant="ghost"
          size="sm"
          className="relative"
          aria-label={count === 0 ? 'Inbox' : `Inbox, ${String(count)} to do`}
          startIcon={<icons.notifications aria-hidden />}
        >
          {count === 0 ? null : (
            <Badge
              size="xs"
              variant="solid"
              tone="danger"
              aria-hidden
              className="absolute -top-0.5 -end-0.5 ring-2 ring-canvas"
            >
              {count}
            </Badge>
          )}
        </Button>
      }
    >
      <div className="flex flex-col gap-1.5 px-3.5 pt-3 pb-1">
        <SegmentedControl
          aria-label="Show"
          fullWidth
          size="sm"
          value={view}
          onValueChange={(next) => {
            if (next === 'todo' || next === 'flagged' || next === 'updates') setView(next);
          }}
        >
          <SegmentedControlItem value="todo">To do · {count}</SegmentedControlItem>
          {decides ? (
            <SegmentedControlItem value="flagged">
              Flagged · {flagged?.length ?? 0}
            </SegmentedControlItem>
          ) : null}
          <SegmentedControlItem value="updates">Updates</SegmentedControlItem>
        </SegmentedControl>
      </div>
      {view === 'updates' ? (
        <div className="p-3.5">
          <Updates shell={shell} />
        </div>
      ) : view === 'flagged' ? (
        flagged === null || flagged.length === 0 ? (
          NOTHING_FLAGGED
        ) : (
          <InboxRows rows={flaggedInboxRows(flagged)} now={shell.now} label="Flagged" />
        )
      ) : count === 0 ? (
        NOTHING_TO_DO
      ) : (
        <InboxRows rows={todo} now={shell.now} label="To do" />
      )}
      {shell.sections.some((s) => s.path.startsWith('/people/review/')) ? (
        <div className="flex border-t border-border px-4 py-2.5">
          <Button asChild variant="link" size="sm">
            <Link href="/people/review/waiting">Open Review</Link>
          </Button>
        </div>
      ) : null}
    </NotificationCenter>
  );
}

/**
 * The Inbox as a phone's tab (MA B3): the bell's views, each its own address,
 * drawn from the shell's data, which the shell already holds, so its loading
 * state is this same screen.
 */
export function Inbox({
  shell,
  person,
  view,
  waking = false,
}: {
  readonly shell: ShellData;
  readonly person: AppShellProps['person'];
  readonly view: InboxView;
  /** People is asleep or still waking: the lists wait for it (`components/waking.tsx`). */
  readonly waking?: boolean;
}): JSX.Element {
  // Only for whoever decides: People flags nothing for anybody else.
  const flagged = shell.roles.hr ? (shell.flagged ?? []) : null;
  const open = view === 'flagged' && flagged === null ? 'todo' : view;
  const todo = todoRows(shell);
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Inbox"
        description="Things to do, from every module you use."
        actions={<AccountSheet person={person} />}
      />
      <InboxViews view={open} todo={todo.length} flagged={flagged?.length ?? null} />
      <Waking area="People" waking={waking}>
        {waking ? null : open === 'flagged' ? (
          flagged === null || flagged.length === 0 ? (
            NOTHING_FLAGGED
          ) : (
            <InboxRows rows={flaggedInboxRows(flagged)} now={shell.now} label="Flagged changes" />
          )
        ) : open === 'updates' ? (
          <Updates shell={shell} />
        ) : todo.length === 0 ? (
          NOTHING_TO_DO
        ) : (
          <InboxRows rows={todo} now={shell.now} label="To do" />
        )}
      </Waking>
    </div>
  );
}
