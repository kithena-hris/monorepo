import type { JSX } from 'react';

import { InboxView } from '../../../components/inbox/view';

/** The Inbox (INB-030): one feed, what is new on top, then what each item needs from you. */
export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<JSX.Element> {
  return <InboxView view="all" searchParams={await searchParams} />;
}
