import {
  Avatar,
  Badge,
  EmptyState,
  List,
  ListItem,
  NotificationItem,
  PageHeader,
  PageSection,
  icons,
} from '@reach/ui';
import Link from 'next/link';
import type { JSX } from 'react';

import { AccountSheet, NoticeList } from '../../../components/app-shell';
import { flatSearch } from '../../../components/people-area';
import { InboxViews } from '../../../components/inbox-views';
import { since } from '../../../components/since';
import { flaggedRows, inboxView, type FlaggedRow, type FlaggedSource } from '../../../lib/inbox';
import { people } from '../../../lib/people';
import { VIEWS } from '../../../lib/people-views';
import { viewedAsNotice } from '../../../lib/shell-data';
import { signedIn } from '../../../lib/signed-in';

/**
 * Inbox (M12, MA6): what the bell holds, as a phone's tab. To do is the same
 * list the bell shows at a desk, so the two never disagree; Flagged is the
 * changes People's checks flagged for the viewer to decide, each with its
 * reason on the row, so they know why before they open it; Updates is what
 * happened to them, every time a People administrator viewed Kithena as them.
 */
export default async function Inbox({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<JSX.Element> {
  const { person, shell } = await signedIn();
  const view = inboxView((await flatSearch(searchParams))['view']);
  // Only for whoever decides: People flags nothing for anybody else.
  let flagged: FlaggedRow[] | null = null;
  if (shell.roles.hr) {
    const answer = await people<never>('Approvals', {});
    flagged = answer.ok
      ? flaggedRows((VIEWS.Approvals(answer.data) as unknown as { items: FlaggedSource[] }).items)
      : [];
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Inbox"
        description="Things to do, from every module you use."
        actions={<AccountSheet person={person} />}
      />
      <InboxViews
        view={view === 'flagged' && flagged === null ? 'todo' : view}
        todo={shell.notices.length}
        flagged={flagged === null ? null : flagged.length}
      />
      {view === 'flagged' && flagged !== null ? (
        flagged.length === 0 ? (
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
                  <span className="inline-flex items-center gap-1.5 font-medium text-warning-fg [&_svg]:size-3">
                    <icons.flagged aria-hidden />
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
      ) : view === 'updates' ? (
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
    </div>
  );
}
