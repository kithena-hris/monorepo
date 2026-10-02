'use client';

import {
  Avatar,
  Badge,
  EmptyState,
  List,
  ListItem,
  NotificationItem,
  PageHeader,
  PageSection,
  Skeleton,
  icons,
} from '@reach/ui';
import Link from 'next/link';
import type { JSX } from 'react';

import type { FlaggedRow, InboxView } from '../lib/inbox';
import { viewedAsNotice, type ShellData } from '../lib/shell-data';
import { AccountSheet, NoticeList, type AppShellProps } from './app-shell';
import { InboxViews } from './inbox-views';
import { since } from './since';
import { Waking } from './waking';

/**
 * Inbox (M12, MA6): what the bell holds, as a phone's tab. To do is the same
 * list the bell shows at a desk, so the two never disagree; Flagged is the
 * changes People's checks flagged for the viewer to decide, each with its
 * reason on the row, so they know why before they open it; Updates is what
 * happened to them, every time a People administrator viewed Kithena as them.
 *
 * Drawn from the shell's data, which the shell already holds, so the page's
 * `loading.tsx` draws this same screen from the shell's copy while the page's
 * own is fetched. Only the flagged rows come from People: `flagged` is null
 * where the viewer decides nothing, and undefined while they are on their way.
 */
export function Inbox({
  shell,
  person,
  view,
  flagged,
  waking = false,
}: {
  readonly shell: ShellData;
  readonly person: AppShellProps['person'];
  readonly view: InboxView;
  readonly flagged: readonly FlaggedRow[] | null | undefined;
  /** People is asleep or still waking: the lists wait for it (`components/waking.tsx`). */
  readonly waking?: boolean;
}): JSX.Element {
  // Only for whoever decides: People flags nothing for anybody else.
  const decides = flagged !== null && (flagged !== undefined || shell.roles.hr);
  const open = view === 'flagged' && !decides ? 'todo' : view;
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Inbox"
        description="Things to do, from every module you use."
        actions={<AccountSheet person={person} />}
      />
      <InboxViews
        view={open}
        todo={shell.notices.length}
        flagged={decides ? (flagged?.length ?? null) : null}
      />
      <Waking area="People" waking={waking}>
        {waking ? null : open === 'flagged' ? (
          flagged === undefined || flagged === null ? (
            // Two rows in a flagged row's height, until People answers.
            <div role="status" className="flex flex-col gap-2">
              <span className="sr-only">Loading flagged changes</span>
              <Skeleton className="h-[5.5rem] w-full" />
              <Skeleton className="h-[5.5rem] w-full" />
            </div>
          ) : flagged.length === 0 ? (
            <EmptyState
              icon={<icons.flagged />}
              title="Nothing flagged"
              description="No change waiting for you looks unusual."
            />
          ) : (
            <List aria-label="Flagged changes">
              {flagged.map((f) => (
                <ListItem
                  key={f.id}
                  asChild
                  leading={<Avatar name={f.name} size="xl" />}
                  description={f.change}
                  supporting={
                    <span className="font-medium text-warning-fg">
                      <icons.flagged aria-hidden className="me-1.5 inline size-3 align-[-1px]" />
                      {f.why}
                    </span>
                  }
                  chevron
                >
                  <Link href={f.href}>
                    {f.name}
                    <Badge size="sm" tone="warning" className="ms-2">
                      <icons.flagged aria-hidden />
                      Unusual
                    </Badge>
                  </Link>
                </ListItem>
              ))}
            </List>
          )
        ) : open === 'updates' ? (
          shell.viewedAs.length === 0 ? (
            <EmptyState
              icon={<icons.notifications />}
              title="No updates"
              description="When something happens to your record, you hear about it here."
            />
          ) : (
            // Every time a People administrator viewed Kithena as them, kept
            // here after the bell has moved on: the entry they can always come back to.
            <PageSection
              title="Viewed as you"
              description="When a People administrator saw Kithena as you, read-only."
            >
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
          )
        ) : shell.notices.length === 0 ? (
          <EmptyState
            icon={<icons.inbox />}
            title="Nothing to do"
            description="Approvals and details you are asked for land here."
          />
        ) : (
          <div className="flex flex-col gap-2">
            <NoticeList shell={shell} />
          </div>
        )}
      </Waking>
    </div>
  );
}
