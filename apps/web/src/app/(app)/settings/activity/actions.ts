'use server';

import type { ActivityLoad, Named } from '../../../../components/activity-log';
import {
  activityFilters,
  activityVariables,
  idsToName,
  type ActivityPage,
} from '../../../../lib/activity';
import { people } from '../../../../lib/people';
import { isWaking } from '../../../../lib/waking';

/**
 * One page of the activity log, newest first from `before` (the last entry's
 * id, or null for the newest), for the address's filters, with the names
 * and faces on it: the page's first read, and each read as the reader
 * scrolls. One router read for the log, as the person signed in — the audit
 * service decides whether they may — and one of People for the names, as
 * they may read them. The filters are read from the address here, so a
 * caller can ask for nothing the address could not.
 */
export async function activityPage(
  search: Readonly<Record<string, string>>,
  before: string | null,
): Promise<{ readonly load: ActivityLoad; readonly named: Named }> {
  const answer = await people<ActivityPage>(
    'Activity',
    activityVariables(activityFilters(search), before),
  );
  if (isWaking(answer)) return { load: { status: 'waking' }, named: {} };
  if (!answer.ok) {
    // Refused by the log itself is the reader's answer. Anything else — no
    // audit subgraph in the graph, the service down, its token not set — is
    // the log not being there yet, and says so rather than failing.
    return {
      load: { status: answer.code === 'FORBIDDEN' ? 'forbidden' : 'unavailable' },
      named: {},
    };
  }
  let named: Named = {};
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
  return { load: { status: 'ready', page: answer.data }, named };
}
