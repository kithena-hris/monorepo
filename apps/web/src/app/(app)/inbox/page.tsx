import { Avatar, EmptyState, NotificationItem, PageHeader, PageSection, icons } from '@reach/ui';
import type { JSX } from 'react';

import { AccountSheet, NoticeList } from '../../../components/app-shell';
import { since } from '../../../components/since';
import { viewedAsNotice } from '../../../lib/shell-data';
import { signedIn } from '../../../lib/signed-in';

/**
 * Inbox (M12): what the bell holds, as a phone's tab. Approvals to decide and
 * details to add, each opening where it is done: the same list the bell shows
 * at a desk, so the two never disagree.
 */
export default async function Inbox(): Promise<JSX.Element> {
  const { person, shell } = await signedIn();
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
