import { redirect } from 'next/navigation';
import type { JSX } from 'react';

import { ActivityLog, type ActivityLoad, type Named } from '../../../../components/activity-log';
import { flatSearch } from '../../../../components/people-area';
import {
  activityFilters,
  activityVariables,
  idsToName,
  type ActivityPage,
} from '../../../../lib/activity';
import { people } from '../../../../lib/people';
import { currentPerson } from '../../../../lib/session';
import { isWaking } from '../../../../lib/waking';

/**
 * Settings › Activity: who did what, and when, across every module the
 * company has (`docs/audit.md`). One router read for the page of the log, as
 * the person signed in — the audit service decides whether they may — and one
 * of People for the names and faces on it, as they may read them.
 */
export default async function Activity({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<JSX.Element> {
  if ((await currentPerson()) === null) redirect('/login');
  const filters = activityFilters(await flatSearch(searchParams));

  const answer = await people<ActivityPage>('Activity', activityVariables(filters));

  let load: ActivityLoad;
  let named: Named = {};
  if (isWaking(answer)) {
    load = { status: 'waking' };
  } else if (answer.ok) {
    load = { status: 'ready', page: answer.data };
    const ids = idsToName(answer.data);
    if (ids.accountIds.length > 0 || ids.personIds.length > 0) {
      // Without People, or where it refuses, entries are named by kind alone.
      const names = await people<{
        people: {
          accountId: string | null;
          personId: string;
          name: string;
          avatarUrl: string | null;
        }[];
      }>('Names', ids);
      if (names.ok) {
        for (const p of names.data.people) {
          const face = { name: p.name, avatarUrl: p.avatarUrl, personId: p.personId };
          named = {
            ...named,
            [p.personId]: face,
            ...(p.accountId === null ? {} : { [p.accountId]: face }),
          };
        }
      }
    }
  } else {
    // Refused by the log itself is the reader's answer. Anything else — no
    // audit subgraph in the graph, the service down, its token not set — is
    // the log not being there yet, and says so rather than failing.
    load = { status: answer.code === 'FORBIDDEN' ? 'forbidden' : 'unavailable' };
  }

  return <ActivityLog load={load} named={named} filters={filters} />;
}
