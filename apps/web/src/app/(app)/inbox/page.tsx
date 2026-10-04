import type { JSX } from 'react';

import { AccountSheet } from '../../../components/app-shell';
import { Inbox } from '../../../components/inbox';
import { flatSearch } from '../../../components/people-area';
import { inboxView } from '../../../lib/inbox';
import { people } from '../../../lib/people';
import { signedIn } from '../../../lib/signed-in';
import { isWaking } from '../../../lib/waking';

/** The inbox, from the shell's data as this request reads it (`components/inbox.tsx`). */
export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<JSX.Element> {
  const { person, shell, entitlements } = await signedIn();
  const view = inboxView((await flatSearch(searchParams))['view']);
  // The shell's own first read, answered already in this request: asleep, the
  // lists wait for People rather than saying there is nothing to do.
  const waking = entitlements.includes('module.people') && isWaking(await people('Home'));
  return (
    <Inbox shell={shell} account={<AccountSheet person={person} />} view={view} waking={waking} />
  );
}
