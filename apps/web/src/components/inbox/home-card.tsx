'use client';

import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  List,
  ListItem,
  Skeleton,
  icons,
} from '@reach/ui';
import { Suspense, use, type JSX } from 'react';

import type { InboxPeek } from '../../lib/inbox/peek';
import { since } from '../since';
import { iconOf } from './format';
import { RowBadges } from './rows';

/**
 * Home's To do (B1): the first rows of the Inbox, and what of theirs waits on
 * somebody else. The same items and the same order as the Inbox, so Home and
 * the Inbox never disagree; it arrives after the page and nothing waits for it.
 */
export function HomeInbox({ inbox }: { readonly inbox: Promise<InboxPeek> }): JSX.Element {
  return (
    <Suspense fallback={<Skeleton shape="block" label="To do" className="h-48" />}>
      <Cards inbox={inbox} />
    </Suspense>
  );
}

function Cards({ inbox }: { readonly inbox: Promise<InboxPeek> }): JSX.Element {
  const peek = use(inbox);
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle level={2}>To do</CardTitle>
          <Button asChild size="sm" variant="link">
            <a href="/inbox/todo">Open Inbox</a>
          </Button>
        </CardHeader>
        <CardContent>
          {peek.todo.length === 0 ? (
            <EmptyState
              icon={<icons.success />}
              title="Nothing needs you"
              description="New tasks from every module appear here."
            />
          ) : (
            <List aria-label="To do" className="-mx-2 bg-transparent shadow-none">
              {peek.todo.map((t) => {
                const Icon = iconOf(t.icon);
                return (
                  <ListItem
                    key={t.id}
                    asChild
                    icon={<Icon aria-hidden />}
                    description={t.summary ?? undefined}
                    supporting={<RowBadges item={t} now={peek.now} zone={peek.zone} />}
                    meta={t.count === null ? since(t.at, peek.now) : String(t.count)}
                  >
                    <a href={`/inbox/todo?item=${encodeURIComponent(t.id)}`}>{t.title}</a>
                  </ListItem>
                );
              })}
            </List>
          )}
        </CardContent>
      </Card>
      {peek.requests.length === 0 ? null : (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle level={2}>Waiting on others</CardTitle>
            <Button asChild size="sm" variant="link">
              <a href="/inbox/requests">My requests</a>
            </Button>
          </CardHeader>
          <CardContent>
            <List aria-label="Waiting on others" className="-mx-2 bg-transparent shadow-none">
              {peek.requests.map((r) => {
                const Icon = iconOf(r.icon);
                return (
                  <ListItem
                    key={r.id}
                    asChild
                    icon={<Icon aria-hidden />}
                    description={[r.status?.label, since(r.at, peek.now)]
                      .filter(Boolean)
                      .join(' · ')}
                  >
                    <a href={`/inbox/requests?item=${encodeURIComponent(r.id)}`}>{r.title}</a>
                  </ListItem>
                );
              })}
            </List>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
