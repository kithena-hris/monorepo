'use client';

import { Avatar, EmptyState, NotificationItem, PageHeader, PageSection, icons } from '@reach/ui';
import type { JSX } from 'react';

import { viewedAsNotice, type ShellData } from '../lib/shell-data';
import { AccountSheet, NoticeList, type AppShellProps } from './app-shell';
import { since } from './since';

/**
 * Inbox (M12): what the bell holds, as a phone's tab. Approvals to decide and
 * details to add, each opening where it is done: the same list the bell shows
 * at a desk, so the two never disagree.
 *
 * Drawn from the shell's data alone, which the shell already holds, so the
 * page's `loading.tsx` draws this same screen from the shell's copy while the
 * page's own is fetched: not a stand-in shaped like it, the screen itself.
 */
export function Inbox({
  shell,
  person,
}: {
  readonly shell: ShellData;
  readonly person: AppShellProps['person'];
}): JSX.Element {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Inbox"
        description="Things to do, from every module you use."
        actions={<AccountSheet person={person} />}
      />
      {shell.notices.length === 0 ? (
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
      {/*
        Every time a People administrator viewed Kithena as them, kept here
        after the bell has moved on: the entry they can always come back to.
      */}
      {shell.viewedAs.length === 0 ? null : (
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
      )}
    </div>
  );
}
