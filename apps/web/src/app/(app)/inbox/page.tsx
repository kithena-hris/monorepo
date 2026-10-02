import type { JSX } from 'react';

import { Inbox } from '../../../components/inbox';
import { flatSearch } from '../../../components/people-area';
import { flaggedRows, inboxView, type FlaggedRow, type FlaggedSource } from '../../../lib/inbox';
import { people } from '../../../lib/people';
import { VIEWS } from '../../../lib/people-views';
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
  // Only for whoever decides: People flags nothing for anybody else.
  let flagged: FlaggedRow[] | null = null;
  if (shell.roles.hr) {
    const answer = await people<never>('Approvals', {});
    flagged = answer.ok
      ? flaggedRows((VIEWS.Approvals(answer.data) as unknown as { items: FlaggedSource[] }).items)
      : [];
  }
  return <Inbox shell={shell} person={person} view={view} flagged={flagged} waking={waking} />;
}
