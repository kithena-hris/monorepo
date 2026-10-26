import type { JSX } from 'react';
import { notFound } from 'next/navigation';

import { viewOf } from '../../../../lib/inbox/model';
import { InboxView } from '../../../../components/inbox/view';

/**
 * A view of the Inbox: the feed filtered to what needs you (`todo`), what
 * waits on others (`requests`) or what is for your information (`updates`),
 * or Snoozed, or Done. Drawn on the server with the open item, so the first
 * paint is the list and the item, never a skeleton.
 */
export default async function InboxLane({
  params,
  searchParams,
}: {
  params: Promise<{ lane: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<JSX.Element> {
  const view = viewOf((await params).lane);
  if (view === null || view === 'all') notFound();
  return <InboxView view={view} searchParams={await searchParams} />;
}
