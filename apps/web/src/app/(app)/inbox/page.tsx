import type { JSX } from 'react';

import { Inbox } from '../../../components/inbox';
import { flatSearch } from '../../../components/people-area';
import { flaggedRows, inboxView, type FlaggedRow, type FlaggedSource } from '../../../lib/inbox';
import { people } from '../../../lib/people';
import { VIEWS } from '../../../lib/people-views';
import { signedIn } from '../../../lib/signed-in';

/** The inbox, from the shell's data as this request reads it (`components/inbox.tsx`). */
export default async function InboxPage({
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
  return <Inbox shell={shell} person={person} view={view} flagged={flagged} />;
}
