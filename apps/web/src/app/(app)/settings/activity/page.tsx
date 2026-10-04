import { redirect } from 'next/navigation';
import type { JSX } from 'react';

import { ActivityLog } from '../../../../components/activity-log';
import { flatSearch } from '../../../../components/people-area';
import { activityFilters } from '../../../../lib/activity';
import { currentPerson } from '../../../../lib/session';
import { activityPage } from './actions';

/**
 * Settings › Activity: who did what, and when, across every module the
 * company has (`docs/audit.md`). The newest page is read here, beside the
 * session check, and older pages as the reader scrolls (`activityPage`).
 */
export default async function Activity({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<JSX.Element> {
  const search = await flatSearch(searchParams);
  // Beside the session check, not after it: a read without a live session is
  // refused (`people`), and is thrown away here before anything is drawn.
  const [person, first] = await Promise.all([currentPerson(), activityPage(search, null)]);
  if (person === null) redirect('/login');
  return (
    <ActivityLog
      load={first.load}
      named={first.named}
      filters={activityFilters(search)}
      onMore={async (before: string) => {
        'use server';
        return activityPage(search, before);
      }}
    />
  );
}
